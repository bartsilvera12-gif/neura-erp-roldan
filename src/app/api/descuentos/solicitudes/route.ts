import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { descuentoMaximoDe } from "@/lib/ventas/server/descuento-maximo";
import { crearSolicitud, listarPendientes } from "@/lib/descuentos/server/solicitudes";

/**
 * Pedidos de descuento por encima del tope.
 *
 *   POST — el vendedor pide. Solo tiene sentido si de verdad pasa su tope.
 *   GET  — el administrador ve lo que tiene para contestar.
 */
export const dynamic = "force-dynamic";

const num = (v: unknown): number => Number(v) || 0;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    // Contestar un pedido de descuento es la decisión que el tope quería
    // reservar: la lista es solo para quien puede tomarla.
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(successResponse({ solicitudes: [], puede_autorizar: false }));
    }
    const solicitudes = await listarPendientes(ctx.supabase, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ solicitudes, puede_autorizar: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/solicitudes_descuento/.test(msg)) {
      return NextResponse.json(successResponse({ solicitudes: [], puede_autorizar: false, falta_migracion: true }));
    }
    console.error("[/api/descuentos/solicitudes GET]", msg);
    return NextResponse.json(errorResponse("No se pudieron cargar los pedidos."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const productoId = txt(b.producto_id);
    const productoNombre = txt(b.producto_nombre) ?? "";
    const pct = num(b.descuento_pct);
    if (!productoId || !productoNombre) {
      return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    }
    if (!(pct > 0) || pct > 100) {
      return NextResponse.json(errorResponse("El descuento tiene que estar entre 0 y 100."), { status: 400 });
    }

    const tope = await descuentoMaximoDe(ctx.supabase, ctx.auth.empresa_id, ctx.auth.usuarioCatalogId);
    // Sin tope no hay nada que autorizar, y pedirlo igual llenaría la campana
    // del administrador de pedidos que el vendedor ya podía hacer solo.
    if (tope == null) {
      return NextResponse.json(
        errorResponse("Tu usuario no tiene tope de descuento: podés aplicarlo sin pedir autorización."),
        { status: 400 }
      );
    }
    if (pct <= tope) {
      return NextResponse.json(
        errorResponse(`${pct}% está dentro de tu tope de ${tope}%: no hace falta autorización.`),
        { status: 400 }
      );
    }

    const solicitud = await crearSolicitud(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      sucursalId: ctx.auth.sucursal_id ?? null,
      solicitanteId: ctx.auth.usuarioCatalogId ?? "",
      solicitanteNombre: ctx.auth.nombre ?? null,
      productoId,
      productoNombre,
      sku: txt(b.sku),
      cantidad: num(b.cantidad) || 1,
      precioLista: num(b.precio_lista),
      precioPedido: num(b.precio_pedido),
      descuentoPct: pct,
      topePct: tope,
      motivo: txt(b.motivo),
    });

    return NextResponse.json(successResponse({ solicitud }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/solicitudes_descuento/.test(msg)) {
      return NextResponse.json(
        errorResponse("Falta correr 35_autorizacion_descuentos.sql en la base."),
        { status: 500 }
      );
    }
    console.error("[/api/descuentos/solicitudes POST]", msg);
    return NextResponse.json(errorResponse("No se pudo enviar el pedido."), { status: 500 });
  }
}
