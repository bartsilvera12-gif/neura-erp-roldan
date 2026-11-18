import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { tieneFacultad } from "@/lib/perfiles/server/facultades-usuario";
import { getVentasAnual } from "@/lib/reportes/server/ventas-anual-pg";
import { bloqueoReporte } from "@/lib/reportes/server/permisos-reportes";

/**
 * GET /api/reportes/ventas-anual?anio=YYYY — Historial de ventas del año, mes
 * por mes. La utilidad y el costo solo van para quien puede ver costos.
 */
export async function GET(request: NextRequest) {
  const bloqueo = await bloqueoReporte(request, "ventas");
  if (bloqueo) return bloqueo;
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCFullYear();
    const pedido = parseInt(new URL(request.url).searchParams.get("anio") ?? "", 10);
    const anio = Number.isFinite(pedido) && pedido >= 2000 && pedido <= hoy + 1 ? pedido : hoy;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const conCostos = await tieneFacultad(ctx.supabase, ctx.auth, "ver_costos");
    const data = await getVentasAnual(schema, ctx.auth.empresa_id, exigirSucursal(ctx.auth.sucursal_id), anio, conCostos);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/ventas-anual]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de ventas."), { status: 500 });
  }
}
