import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getVentasPorVendedor } from "@/lib/reportes/server/vendedores-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import type { VendedoresReporte, AgruparVendedor } from "@/lib/reportes/vendedores-types";

/**
 * GET /api/reportes/vendedores
 *   ?tipo=...&(fecha|semana|mes|trimestre|anio|desde&hasta)  (mismo motor de períodos)
 *   ?agrupar=producto|categoria
 *   ?vendedor=<id>   → además, el detalle completo de ese vendedor
 *
 * Qué vende cada vendedor: facturación, utilidad y los productos que más
 * vende, uno al lado del otro para poder compararlos.
 */
export const dynamic = "force-dynamic";

/** El id llega del front: se acepta solo lo que puede ser una clave de vendedor. */
const ID_RE = /^[0-9a-fA-F-]{1,40}$|^sin-vendedor$/;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
    const agrupar: AgruparVendedor = sp.get("agrupar") === "categoria" ? "categoria" : "producto";
    const vendedorRaw = (sp.get("vendedor") ?? "").trim();
    const vendedor = vendedorRaw && ID_RE.test(vendedorRaw) ? vendedorRaw : null;

    const b = {
      ...boundsDeRangoYmd(per.actual.desde, per.actual.hasta),
      desde: per.actual.desde,
      hasta: per.actual.hasta,
    };

    const res = await getVentasPorVendedor(schema, empresaId, sucursalId, b, agrupar, vendedor);

    const out: VendedoresReporte = {
      tipo: per.tipo,
      agrupar,
      ref: per.ref,
      periodoLabel: per.periodoLabel,
      totalFacturacion: res.totalFacturacion,
      totalCosto: res.totalCosto,
      totalUtilidad: res.totalUtilidad,
      totalVentas: res.totalVentas,
      vendedores: res.vendedores,
      detalle: res.detalle,
    };

    return NextResponse.json(successResponse(out));
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/vendedores]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el reporte por vendedor."),
      { status: 500 }
    );
  }
}
