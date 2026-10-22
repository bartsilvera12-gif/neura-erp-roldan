import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import {
  listLibroVentas,
  computeTotals,
  LibroVentasNoDisponibleError,
  type LibroVentaFilters,
} from "@/lib/libro-ventas/libro-ventas-pg";

export const runtime = "nodejs";

function filtersFromUrl(url: URL): LibroVentaFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  const cond = g("condicion");
  const origen = g("origen");
  const tipo = g("tipo");
  return {
    desde: g("desde"),
    hasta: g("hasta"),
    cliente_id: g("cliente_id"),
    condicion: cond === "contado" || cond === "credito" ? cond : undefined,
    origen: origen === "manual" || origen === "suscripcion" ? origen : undefined,
    tipo: tipo === "factura" || tipo === "nota_credito" ? tipo : undefined,
  };
}

/** GET /api/reportes/libro-ventas — Libro de Ventas fiscal (requiere permiso contabilidad). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroVentas(schema, auth.empresaId, filtersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse({ rows, totals: computeTotals(rows) }));
  } catch (err) {
    // El módulo de facturación electrónica no está instalado en este schema:
    // no es una falla, es un libro vacío. Devolver 500 acá hacía que la
    // pantalla mostrara "No se pudo generar el Libro de Ventas" sin decir por qué.
    if (err instanceof LibroVentasNoDisponibleError) {
      console.warn("[/api/reportes/libro-ventas GET] modulo_fiscal_ausente", {
        empresa_id: auth.empresaId,
        faltantes: err.faltantes,
      });
      return NextResponse.json(
        successResponse({
          rows: [],
          totals: computeTotals([]),
          aviso: err.message,
        }),
      );
    }
    // Para cualquier otra cosa: al usuario un mensaje genérico, pero al log
    // el detalle de Postgres (code/table/column/hint), que es lo único que
    // permite diagnosticar. `err.message` solo perdía toda esa información.
    const pg = err as { code?: string; table?: string; column?: string; detail?: string; hint?: string };
    console.error("[/api/reportes/libro-ventas GET]", {
      empresa_id: auth.empresaId,
      message: err instanceof Error ? err.message : String(err),
      code: pg?.code,
      table: pg?.table,
      column: pg?.column,
      detail: pg?.detail,
      hint: pg?.hint,
    });
    return NextResponse.json(errorResponse("No se pudo generar el Libro de Ventas."), { status: 500 });
  }
}
