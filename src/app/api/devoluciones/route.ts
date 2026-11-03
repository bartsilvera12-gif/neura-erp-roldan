import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa, getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { esSupervisor } from "@/lib/auth/roles-operativos";
import { puedeDevolver } from "@/lib/devoluciones/permiso-devolver";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { crearDevolucion, listarDevoluciones } from "@/lib/devoluciones/server/devoluciones-pg";
import { DevolucionBloqueadaError, type CrearDevolucionInput } from "@/lib/devoluciones/types";

/** Motivos de bloqueo que son culpa del pedido (400) vs conflicto de estado (409). */
const CONFLICTO = new Set(["sin_caja_abierta", "cantidad_excedida", "stock_insuficiente_cambio", "venta_anulada"]);

/** GET /api/devoluciones — historial. */
export async function GET(request: NextRequest) {
  if (!devolucionesEnabled()) {
    return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
  }
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const devoluciones = await listarDevoluciones(schema, auth.empresa_id, {});
    return NextResponse.json(successResponse({ devoluciones }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el historial.";
    console.error("[/api/devoluciones GET]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/** POST /api/devoluciones — confirma una devolucion (transaccional e idempotente). */
export async function POST(request: NextRequest) {
  if (!devolucionesEnabled()) {
    return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
  }
  try {
    // Con el rol: una devolución la autoriza un supervisor o un administrador.
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    /**
     * Bloqueo 0: permisos.
     *
     * Va antes de leer el cuerpo y antes de tocar nada. Una devolución
     * devuelve mercadería al stock y, si es reembolso, saca plata del cajón
     * en el acto: era la única operación del sistema por donde salía dinero
     * sin que nadie la aprobara.
     */
    const permiso = puedeDevolver({
      esAdmin: isAdmin(auth),
      esSupervisor: esSupervisor(auth),
    });
    if (!permiso.permitido) {
      return NextResponse.json(errorResponse(permiso.motivo), { status: 403 });
    }

    const body = (await request.json()) as Partial<CrearDevolucionInput>;

    if (!body.venta_id || typeof body.venta_id !== "string") {
      return NextResponse.json(errorResponse("Falta la venta."), { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(errorResponse("Seleccioná al menos un producto a devolver."), { status: 400 });
    }
    if (!body.idempotency_key || typeof body.idempotency_key !== "string") {
      return NextResponse.json(errorResponse("Falta la clave de idempotencia."), { status: 400 });
    }

    const input: CrearDevolucionInput = {
      venta_id: body.venta_id,
      motivo: typeof body.motivo === "string" ? body.motivo.slice(0, 500) : null,
      resolucion: body.resolucion === "cambio" ? "cambio" : "reembolso",
      items: body.items.map((it) => ({
        venta_item_id: String(it.venta_item_id),
        cantidad: Number(it.cantidad) || 0,
        condicion: it.condicion === "danado" ? "danado" : "buen_estado",
        reintegra_stock: it.reintegra_stock !== false,
      })),
      cambios: Array.isArray(body.cambios)
        ? body.cambios.map((c) => ({ producto_id: String(c.producto_id), cantidad: Number(c.cantidad) || 0 }))
        : [],
      metodo:
        body.metodo === "tarjeta" ? "tarjeta" : body.metodo === "transferencia" ? "transferencia" : "efectivo",
      idempotency_key: body.idempotency_key,
    };

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const devolucion = await crearDevolucion(
      schema,
      auth.empresa_id,
      { id: auth.usuarioCatalogId ?? null, nombre: auth.user?.email ?? null },
      input
    );
    return NextResponse.json(successResponse({ devolucion }));
  } catch (err) {
    if (err instanceof DevolucionBloqueadaError) {
      return NextResponse.json(
        { success: false, error: err.message, motivo: err.motivo },
        { status: CONFLICTO.has(err.motivo) ? 409 : 400 }
      );
    }
    const msg = err instanceof Error ? err.message : "No se pudo confirmar la devolución.";
    console.error("[/api/devoluciones POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
