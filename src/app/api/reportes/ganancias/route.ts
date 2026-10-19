import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import {
  getGananciasPeriodo,
  getGananciasConsignataria,
  sumarGananciasPeriodo,
  type GananciasBounds,
} from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import type { GananciasReporte, GananciasPeriodo, Segmento } from "@/lib/reportes/ganancias-types";

/**
 * GET /api/reportes/ganancias
 *   ?tipo=dia&fecha=YYYY-MM-DD
 *   ?tipo=semana&semana=YYYY-MM-DD
 *   ?tipo=mes&mes=YYYY-MM
 *   ?tipo=trimestre&trimestre=YYYY-MM-DD
 *   ?tipo=anio&anio=YYYY
 *   ?tipo=rango&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Devuelve las métricas del período actual y del anterior (comparación).
 */
export const dynamic = "force-dynamic";

/** Deriva los límites (timestamptz + fecha DATE) de un rango de fechas. */
function boundsDe(rango: { desde: string; hasta: string }): GananciasBounds {
  return { ...boundsDeRangoYmd(rango.desde, rango.hasta), desde: rango.desde, hasta: rango.hasta };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
    const segRaw = sp.get("segmento");
    const segmento: Segmento =
      segRaw === "consignataria" || segRaw === "consolidado" ? segRaw : "nutricion";

    // Calcula el P&L de un rango según el segmento elegido.
    const calc = async (b: GananciasBounds): Promise<GananciasPeriodo> => {
      if (segmento === "nutricion") return getGananciasPeriodo(schema, empresaId, sucursalId, b);
      if (segmento === "consignataria") return getGananciasConsignataria(schema, empresaId, b);
      // consolidado = nutrición + consignataria
      const [nut, cons] = await Promise.all([
        getGananciasPeriodo(schema, empresaId, sucursalId, b),
        getGananciasConsignataria(schema, empresaId, b),
      ]);
      return sumarGananciasPeriodo(nut, cons);
    };

    const [actual, anterior] = await Promise.all([calc(boundsDe(per.actual)), calc(boundsDe(per.anterior))]);

    const out: GananciasReporte = {
      tipo: per.tipo,
      segmento,
      ref: per.ref,
      periodoLabel: per.periodoLabel,
      anteriorLabel: per.anteriorLabel,
      actual,
      anterior,
    };

    return NextResponse.json(successResponse(out));
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/ganancias]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de ganancias."), { status: 500 });
  }
}
