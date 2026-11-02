import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { recalcularCategorias } from "@/lib/clientes/server/categorias-pg";
import { periodoPy } from "@/lib/clientes/categoria-automatica";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * POST /api/clientes/categorias/recalcular — mueve a cada cliente a la
 * categoría que le corresponde por lo que compró en el mes.
 *
 * Body: { periodo?: "YYYY-MM" }  (por defecto, el mes en curso)
 *
 * ── SOLO ADMIN ────────────────────────────────────────────────────────────
 * Cambiar de categoría cambia el precio al que se le vende al cliente. No es
 * una consulta: es una decisión comercial sobre todo el padrón de una vez.
 *
 * ── POR QUÉ TAMBIÉN HAY UN BOTÓN, SI ES AUTOMÁTICO ────────────────────────
 * El ascenso es inmediato: después de cada venta se reevalúa ese cliente solo
 * (ver el llamado en la creación de ventas). Pero el DESCENSO no puede salir de
 * una venta que no ocurrió —el que dejó de comprar no dispara nada— así que
 * hace falta una pasada sobre todos. Este endpoint es esa pasada: se corre a
 * fin de mes, desde la pantalla o desde una tarea programada.
 */
export const dynamic = "force-dynamic";

const RE_PERIODO = /^\d{4}-\d{2}$/;

const FALTA_TABLA =
  "Falta correr 55_categorias_cliente_automaticas.sql en la base.";

function esTablaFaltante(msg: string): boolean {
  return /clientes_categoria_historial|monto_minimo_mensual/.test(msg)
    && /does not exist|42P01|42703/i.test(msg);
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede recategorizar clientes: cambia el precio al que se les vende."),
        { status: 403 }
      );
    }
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const periodo = RE_PERIODO.test(String(b.periodo ?? "")) ? String(b.periodo) : periodoPy();

    // Un período futuro no tiene ventas todavía: recalcular contra él bajaría a
    // todo el padrón a la categoría más baja.
    if (periodo > periodoPy()) {
      return NextResponse.json(
        errorResponse("Ese mes todavía no empezó: no hay ventas con qué calcular."),
        { status: 400 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const resultado = await recalcularCategorias(schema, empresaId, sucursalId, periodo, {
      // `firmaUsuario` resuelve la fila de `usuarios` del tenant; el id de auth
      // no sirve acá porque el historial apunta a esa tabla.
      usuarioId: firma.id,
      usuarioNombre: firma.nombre,
    });

    return NextResponse.json(successResponse({
      ...resultado,
      aviso: resultado.sin_escalera
        ? "Ninguna categoría tiene monto mínimo cargado, así que no se movió a nadie. Cargalos primero en Clientes → Categorías."
        : null,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    if (esTablaFaltante(msg)) {
      return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
    }
    console.error("[/api/clientes/categorias/recalcular]", msg || err);
    if (/Pool no disponible/.test(msg)) {
      return NextResponse.json(
        errorResponse("No hay conexión directa a la base para recalcular."),
        { status: 503 }
      );
    }
    return NextResponse.json(
      errorResponse("No se pudieron recalcular las categorías."),
      { status: 500 }
    );
  }
}
