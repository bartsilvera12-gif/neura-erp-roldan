import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getRentabilidad } from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import type { RentabilidadReporte, AgruparRentabilidad } from "@/lib/reportes/rentabilidad-types";

/**
 * GET /api/reportes/rentabilidad
 *   ?tipo=...&(fecha|semana|mes|trimestre|anio|desde&hasta)  (mismo motor de períodos)
 *   ?agrupar=producto|categoria
 *
 * Rentabilidad de ventas propias (Nutrición): facturación, costo, ganancia,
 * margen y participación en la utilidad, por producto o por categoría.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
    const agrupar: AgruparRentabilidad = sp.get("agrupar") === "categoria" ? "categoria" : "producto";
    const b = { ...boundsDeRangoYmd(per.actual.desde, per.actual.hasta), desde: per.actual.desde, hasta: per.actual.hasta };

    const res = await getRentabilidad(schema, empresaId, sucursalId, b, agrupar);

    const out: RentabilidadReporte = {
      tipo: per.tipo,
      agrupar,
      ref: per.ref,
      periodoLabel: per.periodoLabel,
      totalFacturacion: res.totalFacturacion,
      totalCosto: res.totalCosto,
      totalGanancia: res.totalGanancia,
      filas: res.filas,
    };

    return NextResponse.json(successResponse(out));
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/rentabilidad]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de rentabilidad."), { status: 500 });
  }
}
