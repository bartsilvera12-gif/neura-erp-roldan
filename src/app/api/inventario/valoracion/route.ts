import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { valorizarAFecha } from "@/lib/inventario/server/valoracion-pg";

/**
 * GET /api/inventario/valoracion — inventario y valor del stock a una fecha
 * (punto 1.6).
 *
 * Parámetros:
 *   fecha  — YYYY-MM-DD (hora de Paraguay). Por defecto, hoy. El día entra
 *            completo: pedir el 31/12 incluye todo ese 31.
 *   rubro  — id de rubro. Vacío = general.
 *
 * La reconstrucción está explicada en `valoracion.ts`: se vuelven a pasar los
 * movimientos hasta esa fecha llevando stock y costo promedio ponderado, en
 * vez de usar los valores de hoy, que corresponden a otro momento.
 */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en Paraguay (UTC−3), como YYYY-MM-DD. */
function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const pedida = (sp.get("fecha") ?? "").trim();
    const fecha = RE_FECHA.test(pedida) ? pedida : hoyPy();
    const rubro = (sp.get("rubro") ?? "").trim() || null;

    // Una fecha futura no agrega nada: no hay movimientos después de hoy, así
    // que daría lo mismo que hoy pero con un encabezado que miente.
    if (fecha > hoyPy()) {
      return NextResponse.json(
        errorResponse("La fecha no puede ser futura."),
        { status: 400 }
      );
    }

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const r = await valorizarAFecha(schema, empresaId, sucursalId, fecha, rubro);

    return NextResponse.json(successResponse({ ...r, fecha }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/inventario/valoracion]", msg);
    if (/Pool no disponible/.test(msg)) {
      return NextResponse.json(
        errorResponse("No hay conexión directa a la base para calcular la valoración."),
        { status: 503 }
      );
    }
    return NextResponse.json(
      errorResponse("No se pudo calcular la valoración."),
      { status: 500 }
    );
  }
}
