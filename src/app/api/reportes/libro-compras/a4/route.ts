import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroCompras, computeTotals, type LibroFilters } from "@/lib/libro-compras/libro-compras-pg";
import { htmlLibroIvaA4, type FilaLibroIva } from "@/lib/reportes/server/libro-iva-a4";

export const runtime = "nodejs";

/**
 * GET /api/reportes/libro-compras/a4 — Libro de IVA Compras para imprimir
 * (punto 10.4), con el resumen fiscal al final.
 *
 * Mismos filtros que la pantalla: el libro impreso tiene que decir exactamente
 * lo que se estaba mirando.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new NextResponse(auth.message, { status: auth.status });
  try {
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const origen = g("origen");
    const filtros: LibroFilters = {
      desde: g("desde"),
      hasta: g("hasta"),
      proveedor_id: g("proveedor_id"),
      origen: origen === "compra" || origen === "gasto" ? origen : undefined,
      tipo_comprobante: g("tipo_comprobante"),
      condicion: g("condicion"),
    };

    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroCompras(schema, auth.empresaId, filtros);
    const totals = computeTotals(rows);

    const n = (v: unknown) => Number(v) || 0;
    const filas: FilaLibroIva[] = rows.map((r) => ({
      fecha: r.fecha,
      contraparte: r.proveedor,
      ruc: r.ruc,
      tipo_comprobante: r.tipo_comprobante,
      timbrado: r.timbrado,
      numero: r.numero,
      condicion: r.condicion,
      exento: n(r.exento),
      gravado5: n(r.gravado5),
      iva5: n(r.iva5),
      gravado10: n(r.gravado10),
      iva10: n(r.iva10),
      total: n(r.total),
    }));

    const html = htmlLibroIvaA4({
      libro: "COMPRAS",
      desde: filtros.desde ?? "",
      hasta: filtros.hasta ?? "",
      filas,
      totales: {
        exento: n(totals.exento),
        gravado5: n(totals.gravado5),
        iva5: n(totals.iva5),
        gravado10: n(totals.gravado10),
        iva10: n(totals.iva10),
        total: n(totals.total),
        cantidad: n(totals.cantidad),
      },
      auto: url.searchParams.get("auto") === "1",
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/reportes/libro-compras/a4]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el libro.", { status: 500 });
  }
}
