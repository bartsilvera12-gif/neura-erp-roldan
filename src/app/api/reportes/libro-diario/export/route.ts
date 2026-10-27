import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme } from "@/lib/excel/encabezado";
import { listLibroDiario, type DiarioRow } from "@/lib/contabilidad/libros-pg";
import { diarioFiltersFromUrl } from "../route";

export const runtime = "nodejs";

export const COLUMNAS_LIBRO_DIARIO: ColumnaEstilada<DiarioRow>[] = [
  { header: "N° asiento", value: (r) => r.numero_asiento, width: 14 },
  { header: "Fecha", value: (r) => (r.fecha_contable ? new Date(r.fecha_contable) : ""), formato: "fecha", width: 12 },
  { header: "Glosa", value: (r) => r.glosa ?? "", width: 34 },
  { header: "Origen", value: (r) => r.documento ?? "", width: 18 },
  { header: "Cuenta", value: (r) => r.cuenta_codigo, width: 12 },
  { header: "Denominación", value: (r) => r.cuenta_denominacion, width: 30 },
  { header: "Proveedor", value: (r) => r.proveedor_nombre ?? "", width: 26 },
  { header: "Debe", value: (r) => r.debe, formato: "gs", suma: true, width: 15 },
  { header: "Haber", value: (r) => r.haber, formato: "gs", suma: true, width: 15 },
  { header: "Estado", value: (r) => r.estado, width: 12 },
];

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const filtros = diarioFiltersFromUrl(new URL(request.url));
    const { rows } = await listLibroDiario(schema, auth.empresaId, filtros);
    const emp = await datosEmpresaInforme(auth.empresaId);

    const buf = await buildXlsxEstilado(
      { nombre: "Libro Diario", filas: rows, columnas: COLUMNAS_LIBRO_DIARIO },
      {
        ...emp,
        informe: "Libro Diario",
        periodo: filtros.desde || filtros.hasta ? `Del ${filtros.desde ?? "inicio"} al ${filtros.hasta ?? "hoy"}` : "Todas las fechas",
        notas: ["Debe y Haber tienen que cerrar iguales: si no cierran, hay un asiento incompleto."],
      }
    );
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-diario-${filtros.desde ?? "todo"}`) });
  } catch (e) {
    console.error("[/api/reportes/libro-diario/export]", e instanceof Error ? e.message : e);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
