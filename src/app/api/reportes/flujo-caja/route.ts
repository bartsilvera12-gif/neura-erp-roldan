import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getFlujoCaja } from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import type { FlujoCajaReporte } from "@/lib/reportes/flujo-caja-types";

/**
 * GET /api/reportes/flujo-caja?tipo=...&(fecha|semana|mes|trimestre|anio|desde&hasta)
 * Flujo de caja real: saldo inicial + entradas cobradas − salidas pagadas = saldo final.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const per = resolverPeriodo(new URL(request.url).searchParams);
    const b = { ...boundsDeRangoYmd(per.actual.desde, per.actual.hasta), desde: per.actual.desde, hasta: per.actual.hasta };

    const res = await getFlujoCaja(schema, empresaId, sucursalId, b);

    const out: FlujoCajaReporte = {
      tipo: per.tipo,
      ref: per.ref,
      periodoLabel: per.periodoLabel,
      ...res,
    };

    return NextResponse.json(successResponse(out));
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/flujo-caja]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el flujo de caja."), { status: 500 });
  }
}
