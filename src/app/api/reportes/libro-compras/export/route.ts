import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme } from "@/lib/excel/encabezado";
import { listLibroCompras, type LibroFilters, type LibroCompraRow } from "@/lib/libro-compras/libro-compras-pg";

export const runtime = "nodejs";

function num(v: string | number): number {
  return Number(v) || 0;
}

/** Igual que el Libro de Ventas: los totales son SUBTOTAL, no una fila escrita. */
export const COLUMNAS_LIBRO_COMPRAS: ColumnaEstilada<LibroCompraRow>[] = [
  { header: "Fecha", value: (r) => (r.fecha ? new Date(r.fecha) : ""), formato: "fecha", width: 12 },
  { header: "Origen", value: (r) => r.origen, width: 16 },
  { header: "Proveedor", value: (r) => r.proveedor ?? "", width: 32 },
  { header: "RUC", value: (r) => r.ruc ?? "", width: 15 },
  { header: "Comprobante", value: (r) => r.tipo_comprobante ?? "", width: 16 },
  { header: "Timbrado", value: (r) => r.timbrado ?? "", width: 14 },
  { header: "Número", value: (r) => r.numero ?? "", width: 15 },
  { header: "Condición", value: (r) => r.condicion ?? "", width: 11 },
  { header: "Exento", value: (r) => num(r.exento), formato: "gs", suma: true, width: 14 },
  { header: "Gravado 5%", value: (r) => num(r.gravado5), formato: "gs", suma: true, width: 14 },
  { header: "IVA 5%", value: (r) => num(r.iva5), formato: "gs", suma: true, width: 13 },
  { header: "Gravado 10%", value: (r) => num(r.gravado10), formato: "gs", suma: true, width: 14 },
  { header: "IVA 10%", value: (r) => num(r.iva10), formato: "gs", suma: true, width: 13 },
  { header: "Total", value: (r) => num(r.total), formato: "gs", suma: true, width: 15 },
  { header: "Estado", value: (r) => r.estado, width: 12 },
];

/** GET /api/reportes/libro-compras/export — Excel del Libro de Compras (respeta filtros). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const origen = g("origen");
    const filters: LibroFilters = {
      desde: g("desde"), hasta: g("hasta"), proveedor_id: g("proveedor_id"),
      origen: origen === "compra" || origen === "gasto" ? origen : undefined,
      tipo_comprobante: g("tipo_comprobante"), condicion: g("condicion"),
    };
    const rows = await listLibroCompras(schema, auth.empresaId, filters);
    const emp = await datosEmpresaInforme(auth.empresaId);

    const buf = await buildXlsxEstilado(
      { nombre: "Libro de Compras", filas: rows, columnas: COLUMNAS_LIBRO_COMPRAS },
      {
        ...emp,
        informe: "Libro de Compras (IVA Compras)",
        periodo: filters.desde || filters.hasta ? `Del ${filters.desde ?? "inicio"} al ${filters.hasta ?? "hoy"}` : "Todas las fechas",
        notas: ["Los totales son SUBTOTAL: si se filtra la planilla, se recalculan con lo que queda a la vista."],
      }
    );

    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-compras-${filters.desde ?? "todo"}`) });
  } catch (err) {
    console.error("[/api/reportes/libro-compras/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
