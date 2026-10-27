import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getRentabilidad } from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

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
 *
 * ── POR QUÉ LOS PORCENTAJES SE DIVIDEN POR 100 ─────────────────────────────
 *   El cálculo los devuelve como 35 para "35%", pero el formato porcentual de
 *   Excel espera 0,35 y multiplica por cien al mostrar. Sin dividir, un margen
 *   del 35% se imprimiría como 3.500%.
 */
export const dynamic = "force-dynamic";

interface FilaRent {
  nombre: string;
  sku?: string | null;
  categoria?: string | null;
  unidades: number;
  facturacion: number;
  costo: number;
  ganancia: number;
  margen: number;
  participacion: number;
}

const COLS_COMUNES: ColumnaEstilada<FilaRent>[] = [
  { header: "Unidades", value: (x) => x.unidades, formato: "cantidad", suma: true, width: 12 },
  { header: "Facturación sin IVA", value: (x) => x.facturacion, formato: "gs", suma: true, width: 20 },
  { header: "Costo", value: (x) => x.costo, formato: "gs", suma: true, width: 17 },
  { header: "Utilidad Gs.", value: (x) => x.ganancia, formato: "gs", suma: true, width: 18 },
  { header: "Margen", value: (x) => x.margen / 100, formato: "porcentaje", width: 11 },
  { header: "% de la utilidad total", value: (x) => x.participacion / 100, formato: "porcentaje", width: 20 },
];

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
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
    const [emp, suc] = await Promise.all([datosEmpresaInforme(empresaId), nombreSucursal(sucursalId)]);

    const margenTotal =
      porRubro.totalFacturacion > 0 ? (porRubro.totalGanancia / porRubro.totalFacturacion) * 100 : 0;

    const resumen = [
      { concepto: "Período", valor: per.periodoLabel },
      { concepto: "Desde", valor: per.actual.desde },
      { concepto: "Hasta", valor: per.actual.hasta },
      { concepto: "Facturación sin IVA", valor: formatearGs(porRubro.totalFacturacion) },
      { concepto: "Costo de lo vendido", valor: formatearGs(porRubro.totalCosto) },
      { concepto: "Utilidad bruta (Gs.)", valor: formatearGs(porRubro.totalGanancia) },
      { concepto: "Margen sobre venta", valor: `${margenTotal.toFixed(2)} %` },
      {
        concepto: "Nota",
        valor:
          "La utilidad es plata; el margen es un porcentaje. Un rubro con margen alto " +
          "y poca venta deja menos que uno con margen bajo y mucha venta.",
      },
      { concepto: "Excluye", valor: "Ventas anuladas y de consignación." },
    ];

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 28 },
          { header: "Valor", value: (x) => x.valor, width: 70 },
        ],
      }),
      hoja({
        nombre: "Por rubro", filas: porRubro.filas as FilaRent[],
        columnas: [{ header: "Rubro", value: (x: FilaRent) => x.nombre, width: 34 }, ...COLS_COMUNES],
      }),
      hoja({
        nombre: "Por producto", filas: porProducto.filas as FilaRent[],
        columnas: [
          { header: "Producto", value: (x: FilaRent) => x.nombre, width: 38 },
          { header: "SKU", value: (x: FilaRent) => x.sku ?? "", width: 16 },
          { header: "Rubro", value: (x: FilaRent) => x.categoria ?? "Sin rubro", width: 24 },
          ...COLS_COMUNES,
        ],
      }),
    ], {
      ...emp, informe: "Utilidad por período", periodo: per.periodoLabel, sucursal: suc,
      notas: ["Excluye ventas anuladas y de consignación."],
    });

    // El nombre lleva el período: tres planillas descargadas el mismo día se
    // distinguen sin abrirlas.
    const nombre = `utilidad-${per.actual.desde}_${per.actual.hasta}`;
    return new Response(new Uint8Array(buf), { headers: xlsxResponseHeaders(nombre) });
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/rentabilidad/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar la planilla.", { status: 500 });
  }
}
