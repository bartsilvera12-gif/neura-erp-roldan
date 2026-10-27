import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme } from "@/lib/excel/encabezado";
import { listLibroVentas, type LibroVentaFilters, type LibroVentaRow } from "@/lib/libro-ventas/libro-ventas-pg";

export const runtime = "nodejs";

const num = (v: string | number) => Number(v) || 0;

/** Hora de Paraguay (UTC−3) de un timestamp, como HH:MM. */
function horaPy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

/**
 * Columnas del Libro de Ventas.
 *
 * Los totales ya no se calculan acá y se pegan como última fila: las columnas
 * marcadas con `suma` se cierran con un SUBTOTAL en la planilla. La diferencia
 * importa cuando el contador filtra por cliente o por condición: un total
 * escrito a mano sigue mostrando el del mes entero y lleva a declarar mal; el
 * SUBTOTAL se recalcula con lo que quedó a la vista.
 */
export const COLUMNAS_LIBRO_VENTAS: ColumnaEstilada<LibroVentaRow>[] = [
  { header: "Fecha", value: (r) => (r.fecha ? new Date(r.fecha) : ""), formato: "fecha", width: 12 },
  // La hora va aparte y como texto. El archivo que el cliente sacaba del
  // sistema anterior la traía, y sirve para ubicar una factura cuando hay
  // varias del mismo cliente el mismo día. Como texto y no como hora de Excel
  // porque si no la columna hereda el formato de fecha y muestra 00/01/1900.
  { header: "Hora", value: (r) => horaPy(r.fecha), width: 9 },
  { header: "Comprobante", value: (r) => r.tipo_comprobante, width: 16 },
  { header: "Origen", value: (r) => r.origen, width: 12 },
  { header: "Cliente", value: (r) => r.cliente ?? "", width: 32 },
  { header: "RUC", value: (r) => r.ruc ?? "", width: 15 },
  { header: "Timbrado", value: (r) => r.timbrado ?? "", width: 14 },
  { header: "Número", value: (r) => r.numero ?? "", width: 16 },
  { header: "Condición", value: (r) => r.condicion ?? "", width: 11 },
  { header: "Exento", value: (r) => num(r.exento), formato: "gs", suma: true, width: 14 },
  { header: "Gravado 5%", value: (r) => num(r.gravado5), formato: "gs", suma: true, width: 14 },
  { header: "IVA 5%", value: (r) => num(r.iva5), formato: "gs", suma: true, width: 13 },
  { header: "Gravado 10%", value: (r) => num(r.gravado10), formato: "gs", suma: true, width: 14 },
  { header: "IVA 10%", value: (r) => num(r.iva10), formato: "gs", suma: true, width: 13 },
  { header: "Total", value: (r) => num(r.total), formato: "gs", suma: true, width: 15 },
  { header: "Estado", value: (r) => r.estado, width: 12 },
];

/** GET /api/reportes/libro-ventas/export — Excel del Libro de Ventas (respeta filtros). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const cond = g("condicion"); const origen = g("origen"); const tipo = g("tipo");
    const filters: LibroVentaFilters = {
      desde: g("desde"), hasta: g("hasta"), cliente_id: g("cliente_id"),
      condicion: cond === "contado" || cond === "credito" ? cond : undefined,
      origen: origen === "manual" || origen === "suscripcion" ? origen : undefined,
      tipo: tipo === "factura" || tipo === "nota_credito" ? tipo : undefined,
    };
    const rows = await listLibroVentas(schema, auth.empresaId, filters);
    const emp = await datosEmpresaInforme(auth.empresaId);

    const periodo =
      filters.desde || filters.hasta
        ? `Del ${filters.desde ?? "inicio"} al ${filters.hasta ?? "hoy"}`
        : "Todas las fechas";

    const buf = await buildXlsxEstilado(
      { nombre: "Libro de Ventas", filas: rows, columnas: COLUMNAS_LIBRO_VENTAS },
      {
        ...emp,
        informe: "Libro de Ventas (IVA Ventas)",
        periodo,
        notas: ["Los totales son SUBTOTAL: si se filtra la planilla, se recalculan con lo que queda a la vista."],
      }
    );

    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-ventas-${filters.desde ?? "todo"}`) });
  } catch (err) {
    console.error("[/api/reportes/libro-ventas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
