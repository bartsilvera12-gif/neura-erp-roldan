import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, type ColumnaEstilada } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";
import { getEgresosDelMes, type EgresoRow } from "@/lib/reportes/server/mes-detalle-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const n = (v: string | number) => Number(v) || 0;

/**
 * Egresos del mes. Reemplaza el `egreso-<mes>-<año>_<SUCURSAL>.xls`.
 *
 * Es el otro lado del Libro de Compras, que deja los gastos afuera porque
 * muchos no tienen timbrado. Acá entran todos: el alquiler y la luz son plata
 * que salió, con o sin comprobante fiscal.
 */
const COLUMNAS: ColumnaEstilada<EgresoRow>[] = [
  { header: "Fecha", value: (r) => (r.fecha ? new Date(r.fecha) : ""), formato: "fecha", width: 12 },
  { header: "Rubro", value: (r) => r.rubro ?? "", width: 22 },
  { header: "Beneficiario", value: (r) => r.beneficiario ?? "", width: 32 },
  { header: "RUC", value: (r) => r.proveedor_ruc ?? "", width: 15 },
  { header: "Timbrado", value: (r) => r.nro_timbrado ?? "", width: 14 },
  { header: "N° factura", value: (r) => r.numero_factura ?? "", width: 16 },
  { header: "Descripción", value: (r) => r.descripcion ?? "", width: 36 },
  { header: "Medio de pago", value: (r) => r.metodo_pago ?? "", width: 15 },
  { header: "Exenta", value: (r) => n(r.exenta), formato: "gs", suma: true, width: 14 },
  { header: "Gravado 5%", value: (r) => n(r.gravado_5), formato: "gs", suma: true, width: 14 },
  { header: "IVA 5%", value: (r) => n(r.iva_5), formato: "gs", suma: true, width: 13 },
  { header: "Gravado 10%", value: (r) => n(r.gravado_10), formato: "gs", suma: true, width: 14 },
  { header: "IVA 10%", value: (r) => n(r.iva_10), formato: "gs", suma: true, width: 13 },
  { header: "Total", value: (r) => n(r.monto), formato: "gs", suma: true, width: 16 },
];

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const b = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const filas = await getEgresosDelMes(schema, ctx.auth.empresa_id, sucursalId, b);
    const [emp, suc] = await Promise.all([
      datosEmpresaInforme(ctx.auth.empresa_id),
      nombreSucursal(sucursalId),
    ]);

    // Por rubro: es la pregunta que se hace al mirar los gastos del mes
    // ("¿en qué se nos fue la plata?"), y en el detalle hay que sumarla a ojo.
    const porRubro = new Map<string, { rubro: string; cantidad: number; total: number }>();
    for (const f of filas) {
      const k = f.rubro ?? "Sin rubro";
      const a = porRubro.get(k) ?? { rubro: k, cantidad: 0, total: 0 };
      a.cantidad += 1;
      a.total += n(f.monto);
      porRubro.set(k, a);
    }
    const rubros = [...porRubro.values()].sort((a, b2) => b2.total - a.total);
    const total = filas.reduce((s, f) => s + n(f.monto), 0);

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen",
        filas: [
          { concepto: "Egresos del mes", valor: String(filas.length) },
          { concepto: "Total egresado", valor: formatearGs(total) },
        ],
        sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 28 },
          { header: "Valor", value: (x) => x.valor, width: 24 },
        ],
      }),
      hoja({
        nombre: "Por rubro", filas: rubros,
        columnas: [
          { header: "Rubro", value: (x) => x.rubro, width: 30 },
          { header: "Egresos", value: (x) => x.cantidad, formato: "entero", suma: true, width: 11 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 18 },
        ],
      }),
      hoja({ nombre: "Egresos", filas, columnas: COLUMNAS }),
    ], {
      ...emp, informe: "Egresos del mes", periodo: mesLabelLargo(mes), sucursal: suc,
      notas: ["Incluye gastos sin comprobante fiscal, que por eso no figuran en el Libro de Compras."],
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`egresos-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/egresos/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
