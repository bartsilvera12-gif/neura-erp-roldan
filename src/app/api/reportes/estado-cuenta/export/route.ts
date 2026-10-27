import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getEstadoCuenta } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const r = await getEstadoCuenta(schema, ctx.auth.empresa_id, sucursalId, { mes, start, end, mesInicio: `${mes}-01` });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Ingresos por ventas", valor: formatearGs(r.ingresosVentas) },
      { concepto: "Compras", valor: formatearGs(r.compras) },
      { concepto: "Gastos", valor: formatearGs(r.gastos) },
      { concepto: "Resultado (ventas − compras − gastos)", valor: formatearGs(r.resultado) },
      { concepto: "Por cobrar (ventas a crédito)", valor: formatearGs(r.porCobrar) },
      { concepto: "Por pagar (compras a crédito)", valor: formatearGs(r.porPagar) },
    ];

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 40 },
          { header: "Valor", value: (x) => x.valor, width: 24 },
        ],
      }),
      hoja({
        nombre: "Movimientos", filas: r.movimientos,
        columnas: [
          { header: "Fecha", value: (m) => (m.fecha ? new Date(m.fecha) : ""), formato: "fecha", width: 12 },
          { header: "Tipo", value: (m) => m.tipo, width: 14 },
          { header: "Referencia", value: (m) => m.referencia, width: 18 },
          { header: "Descripción", value: (m) => m.descripcion, width: 36 },
          { header: "Entrada", value: (m) => m.entrada, formato: "gs", suma: true, width: 17 },
          { header: "Salida", value: (m) => m.salida, formato: "gs", suma: true, width: 17 },
        ],
      }),
    ], {
      ...emp, informe: "Estado de cuenta", periodo: mesLabelLargo(mes), sucursal: suc,
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`estado-cuenta-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/estado-cuenta/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
