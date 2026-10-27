import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteConciliacion } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, formatearCantidad } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
  qr: "QR", billetera: "Billetera", otro: "Otro",
};
const metodoLabel = (m: string | null) => (m ? METODO[m] ?? m : "");

/** GET /api/reportes/conciliacion/export?mes=YYYY-MM → XLSX (Resumen + Por método + Por entidad + Movimientos). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const r = await getReporteConciliacion(schema, ctx.auth.empresa_id, sucursalId, { mes, start, end, mesInicio: `${mes}-01` });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Total cobrado (según detalle)", valor: formatearGs(r.totalCobrado) },
      { concepto: "Operaciones", valor: formatearCantidad(r.cantidadOperaciones) },
    ];

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 34 },
          { header: "Valor", value: (x) => x.valor, width: 24 },
        ],
      }),
      hoja({
        nombre: "Por método", filas: r.porMetodo,
        columnas: [
          { header: "Método", value: (x) => metodoLabel(x.clave), width: 18 },
          { header: "Operaciones", value: (x) => x.cantidad, formato: "entero", suma: true, width: 13 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Por entidad", filas: r.porEntidad,
        columnas: [
          { header: "Entidad", value: (x) => x.clave, width: 30 },
          { header: "Operaciones", value: (x) => x.cantidad, formato: "entero", suma: true, width: 13 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Movimientos", filas: r.movimientos,
        columnas: [
          { header: "Fecha", value: (m) => (m.fecha ? new Date(m.fecha) : ""), formato: "fecha", width: 12 },
          { header: "Tipo", value: (m) => (m.tipo === "cobro" ? "Cobro CxC" : "Venta"), width: 13 },
          { header: "N° venta", value: (m) => m.numero ?? "", width: 16 },
          { header: "Cliente", value: (m) => m.cliente ?? "", width: 28 },
          { header: "Método", value: (m) => metodoLabel(m.metodo_pago), width: 16 },
          { header: "Entidad", value: (m) => m.entidad ?? "", width: 24 },
          { header: "N° comprobante", value: (m) => m.referencia ?? "", width: 20 },
          { header: "Titular", value: (m) => m.titular ?? "", width: 24 },
          { header: "Monto", value: (m) => m.monto, formato: "gs", suma: true, width: 17 },
          { header: "Estado", value: (m) => (m.estado === "aprobado" ? "Aprobado" : m.estado === "rechazado" ? "Rechazado" : "Pendiente"), width: 14 },
        ],
      }),
    ], {
      ...emp, informe: "Conciliación de cobros", periodo: mesLabelLargo(mes), sucursal: suc,
      notas: ["Es lo cobrado por cada medio, para cruzar contra el extracto del banco."],
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`conciliacion-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/conciliacion/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
