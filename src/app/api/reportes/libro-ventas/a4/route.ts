import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import {
  listLibroVentas,
  computeTotals,
  LibroVentasNoDisponibleError,
  type LibroVentaFilters,
} from "@/lib/libro-ventas/libro-ventas-pg";
import { htmlLibroIvaA4, type FilaLibroIva } from "@/lib/reportes/server/libro-iva-a4";

export const runtime = "nodejs";

/**
 * GET /api/reportes/libro-ventas/a4 — Libro de IVA Ventas para imprimir
 * (punto 10.4), con el resumen fiscal al final.
 *
 * El resumen incluye el neto facturado: facturas menos notas de crédito. Es la
 * cifra que no se puede leer de la columna Total, porque ahí las notas ya van
 * mezcladas con las facturas.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new NextResponse(auth.message, { status: auth.status });
  try {
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const cond = g("condicion");
    const origen = g("origen");
    const tipo = g("tipo");
    const filtros: LibroVentaFilters = {
      desde: g("desde"),
      hasta: g("hasta"),
      cliente_id: g("cliente_id"),
      condicion: cond === "contado" || cond === "credito" ? cond : undefined,
      origen: origen === "manual" || origen === "suscripcion" ? origen : undefined,
      tipo: tipo === "factura" || tipo === "nota_credito" ? tipo : undefined,
    };

    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroVentas(schema, auth.empresaId, filtros);
    const totals = computeTotals(rows);

    const n = (v: unknown) => Number(v) || 0;
    const filas: FilaLibroIva[] = rows.map((r) => ({
      fecha: r.fecha,
      contraparte: r.cliente,
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
      es_nota_credito: r.origen_tipo === "nota_credito",
    }));

    const html = htmlLibroIvaA4({
      libro: "VENTAS",
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
      neto: {
        facturas: n(totals.facturas_total),
        notas_credito: n(totals.nc_total),
        neto: n(totals.neto),
      },
      auto: url.searchParams.get("auto") === "1",
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof LibroVentasNoDisponibleError) {
      return new NextResponse(err.message, { status: 409 });
    }
    console.error("[/api/reportes/libro-ventas/a4]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el libro.", { status: 500 });
  }
}
