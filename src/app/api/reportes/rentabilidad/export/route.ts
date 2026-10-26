import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getRentabilidad } from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";
import type { AgruparRentabilidad } from "@/lib/reportes/rentabilidad-types";

/**
 * GET /api/reportes/rentabilidad/export → XLSX de utilidad por período
 * (punto 10.1, con el requisito general 11.1 de poder exportar).
 *
 * Mismos parámetros que el reporte en pantalla: el período (mes, rango, etc.)
 * y `agrupar=producto|categoria`.
 *
 * ── POR QUÉ DOS HOJAS Y NO UNA ─────────────────────────────────────────────
 *   La hoja "Por rubro" es la que se mira para decidir en qué rubro conviene
 *   empujar; la de "Por producto" es para encontrar el artículo puntual que
 *   arrastra el promedio del rubro hacia abajo. Separadas, cada una se puede
 *   ordenar y filtrar sin desarmar la otra.
 *
 * ── GANANCIA Y MARGEN SON COLUMNAS DISTINTAS, A PROPÓSITO ──────────────────
 *   El punto 10.1 lo pide con estas palabras: "diferenciar ganancia monetaria
 *   del % de margen". Un rubro al 60% que vende poco deja menos plata que uno
 *   al 12% que vende mucho. Por eso la planilla trae las dos, más la
 *   participación: qué porcentaje de la utilidad total aporta cada fila.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
    const agrupar: AgruparRentabilidad = sp.get("agrupar") === "categoria" ? "categoria" : "producto";
    const b = {
      ...boundsDeRangoYmd(per.actual.desde, per.actual.hasta),
      desde: per.actual.desde,
      hasta: per.actual.hasta,
    };

    // Se traen las dos agrupaciones: la planilla sirve para las dos preguntas
    // sin tener que exportarla dos veces.
    const [porRubro, porProducto] = await Promise.all([
      getRentabilidad(schema, empresaId, sucursalId, b, "categoria"),
      getRentabilidad(schema, empresaId, sucursalId, b, "producto"),
    ]);

    const margenTotal =
      porRubro.totalFacturacion > 0 ? (porRubro.totalGanancia / porRubro.totalFacturacion) * 100 : 0;

    const resumen = [
      { concepto: "Reporte", valor: "Utilidad por período" },
      { concepto: "Período", valor: per.periodoLabel },
      { concepto: "Desde", valor: per.actual.desde },
      { concepto: "Hasta", valor: per.actual.hasta },
      { concepto: "Facturación sin IVA", valor: porRubro.totalFacturacion },
      { concepto: "Costo de lo vendido", valor: porRubro.totalCosto },
      { concepto: "Utilidad bruta (Gs.)", valor: porRubro.totalGanancia },
      { concepto: "Margen sobre venta (%)", valor: Number(margenTotal.toFixed(2)) },
      {
        concepto: "Nota",
        valor:
          "La utilidad es plata; el margen es un porcentaje. Un rubro con margen alto " +
          "y poca venta deja menos que uno con margen bajo y mucha venta.",
      },
      { concepto: "Excluye", valor: "Ventas anuladas y de consignación." },
    ];

    const columnasRubro = [
      { header: "Rubro", value: (x: { nombre: string }) => x.nombre, width: 34 },
      { header: "Unidades", value: (x: { unidades: number }) => x.unidades, width: 12 },
      { header: "Facturación sin IVA", value: (x: { facturacion: number }) => x.facturacion, width: 20 },
      { header: "Costo", value: (x: { costo: number }) => x.costo, width: 16 },
      { header: "Utilidad (Gs.)", value: (x: { ganancia: number }) => x.ganancia, width: 18 },
      { header: "Margen %", value: (x: { margen: number }) => Number(x.margen.toFixed(2)), width: 12 },
      {
        header: "% de la utilidad total",
        value: (x: { participacion: number }) => Number(x.participacion.toFixed(2)),
        width: 20,
      },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 30 },
        { header: "Valor", value: (x) => x.valor, width: 70 },
      ]),
      sheetFromRows("Por rubro", porRubro.filas, columnasRubro),
      sheetFromRows("Por producto", porProducto.filas, [
        { header: "Producto", value: (x) => x.nombre, width: 38 },
        { header: "SKU", value: (x) => x.sku ?? "", width: 16 },
        { header: "Rubro", value: (x) => x.categoria ?? "Sin rubro", width: 24 },
        { header: "Unidades", value: (x) => x.unidades, width: 12 },
        { header: "Facturación sin IVA", value: (x) => x.facturacion, width: 20 },
        { header: "Costo", value: (x) => x.costo, width: 16 },
        { header: "Utilidad (Gs.)", value: (x) => x.ganancia, width: 18 },
        { header: "Margen %", value: (x) => Number(x.margen.toFixed(2)), width: 12 },
        { header: "% de la utilidad total", value: (x) => Number(x.participacion.toFixed(2)), width: 20 },
      ]),
    ]);

    // El nombre lleva el período: tres planillas descargadas el mismo día se
    // distinguen sin abrirlas.
    const nombre = `utilidad-${per.actual.desde}_${per.actual.hasta}.xlsx`;
    return new Response(new Uint8Array(buf), { headers: xlsxResponseHeaders(nombre) });
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/rentabilidad/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar la planilla.", { status: 500 });
  }
}
