import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroVentasTotal, computeTotals, type LibroVentaTotalFilters } from "@/lib/libro-ventas-total/libro-ventas-total-pg";

export const runtime = "nodejs";

function filtersFromUrl(url: URL): LibroVentaTotalFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  const origen = g("origen");
  return {
    desde: g("desde"),
    hasta: g("hasta"),
    cliente_id: g("cliente_id"),
    origen: origen === "factura" || origen === "ticket" ? origen : undefined,
    metodo_pago: g("metodo_pago"),
  };
}

/** GET /api/reportes/libro-ventas-total — Libro Ventas TOTAL (facturas + tickets). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroVentasTotal(schema, auth.empresaId, filtersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse({ rows, totals: computeTotals(rows) }));
  } catch (err) {
    console.error("[/api/reportes/libro-ventas-total GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el Libro de Ventas Total."), { status: 500 });
  }
}
