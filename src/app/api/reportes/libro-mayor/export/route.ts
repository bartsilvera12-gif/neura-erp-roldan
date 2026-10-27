import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstilado, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme } from "@/lib/excel/encabezado";
import { listLibroMayor } from "@/lib/contabilidad/libros-pg";
import { mayorFiltersFromUrl } from "../route";

export const runtime = "nodejs";

interface FlatRow {
  cuenta: string; denominacion: string; naturaleza: string; tipo: string;
  fecha: string; numero_asiento: string; documento: string; descripcion: string;
  proveedor: string; debe: number; haber: number; saldo: number;
}

/**
 * ── POR QUÉ ESTA PLANILLA NO LLEVA FILA DE TOTALES ────────────────────────
 *   Cada cuenta aporta tres clases de renglón: el saldo inicial, sus
 *   movimientos, y el saldo final — y el saldo final ya trae el acumulado de
 *   Debe y Haber de esa cuenta. Sumar la columna entera contaría dos veces lo
 *   mismo y daría el doble del movimiento real. El cierre del mayor se lee por
 *   cuenta, en los renglones SALDO FINAL, no al pie de la hoja.
 */
export const COLUMNAS_LIBRO_MAYOR: ColumnaEstilada<FlatRow>[] = [
  { header: "Cuenta", value: (r) => r.cuenta, width: 12 },
  { header: "Denominación", value: (r) => r.denominacion, width: 30 },
  { header: "Nat.", value: (r) => r.naturaleza, width: 7 },
  { header: "Tipo", value: (r) => r.tipo, width: 15 },
  { header: "Fecha", value: (r) => (r.fecha ? new Date(r.fecha) : ""), formato: "fecha", width: 12 },
  { header: "N° asiento", value: (r) => r.numero_asiento, width: 14 },
  { header: "Documento", value: (r) => r.documento, width: 18 },
  { header: "Descripción", value: (r) => r.descripcion, width: 30 },
  { header: "Proveedor", value: (r) => r.proveedor, width: 24 },
  { header: "Debe", value: (r) => r.debe, formato: "gs", width: 15 },
  { header: "Haber", value: (r) => r.haber, formato: "gs", width: 15 },
  { header: "Saldo", value: (r) => r.saldo, formato: "gs", width: 15 },
];

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const filtros = mayorFiltersFromUrl(new URL(request.url));
    const { cuentas } = await listLibroMayor(schema, auth.empresaId, filtros);
    const flat: FlatRow[] = [];
    const docLabel = (o: string) => (o === "compra" ? "Compra" : o === "gasto_servicio" ? "Gasto y Servicio" : o === "reversion" ? "Reversión" : o);
    for (const c of cuentas) {
      flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "SALDO INICIAL", fecha: "", numero_asiento: "", documento: "", descripcion: "", proveedor: "", debe: 0, haber: 0, saldo: c.saldo_inicial });
      for (const m of c.movimientos) {
        flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "MOV", fecha: m.fecha_contable, numero_asiento: m.numero_asiento, documento: docLabel(m.origen_tipo), descripcion: m.descripcion ?? "", proveedor: m.proveedor_nombre ?? "", debe: m.debe, haber: m.haber, saldo: m.saldo_acumulado });
      }
      flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "SALDO FINAL", fecha: "", numero_asiento: "", documento: "", descripcion: "", proveedor: "", debe: c.total_debe, haber: c.total_haber, saldo: c.saldo_final });
    }
    const emp = await datosEmpresaInforme(auth.empresaId);

    const buf = await buildXlsxEstilado(
      { nombre: "Libro Mayor", filas: flat, columnas: COLUMNAS_LIBRO_MAYOR, totales: false },
      {
        ...emp,
        informe: "Libro Mayor",
        periodo: filtros.desde || filtros.hasta ? `Del ${filtros.desde ?? "inicio"} al ${filtros.hasta ?? "hoy"}` : "Todas las fechas",
        notas: ["El cierre de cada cuenta está en su renglón SALDO FINAL; la hoja no lleva total al pie porque sumaría dos veces el mismo movimiento."],
      }
    );
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-mayor-${filtros.desde ?? "todo"}`) });
  } catch (e) {
    console.error("[/api/reportes/libro-mayor/export]", e instanceof Error ? e.message : e);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
