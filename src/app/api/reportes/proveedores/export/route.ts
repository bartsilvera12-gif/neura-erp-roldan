import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteProveedores } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, formatearCantidad } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const r = await getReporteProveedores(schema, ctx.auth.empresa_id, sucursalId, { mes, start, end, mesInicio: `${mes}-01` });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Total proveedores", valor: formatearCantidad(r.totalProveedores) },
      { concepto: "Proveedores con compras en el mes", valor: formatearCantidad(r.conCompras) },
      { concepto: "Total comprado del mes", valor: formatearGs(r.totalComprado) },
      { concepto: "Compra promedio por proveedor activo", valor: formatearGs(r.compraPromedio) },
      { concepto: "Última compra", valor: r.ultimaCompra ? `${r.ultimaCompra.numero_control} · ${r.ultimaCompra.proveedor_nombre} (${formatearGs(r.ultimaCompra.total)})` : "—" },
    ];

    const conCompras = r.proveedores.filter((p) => p.cantidad > 0);

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 38 },
          { header: "Valor", value: (x) => x.valor, width: 50 },
        ],
      }),
      hoja({
        nombre: "Proveedores", filas: r.proveedores,
        columnas: [
          { header: "Proveedor", value: (p) => p.nombre, width: 34 },
          { header: "RUC", value: (p) => p.ruc ?? "", width: 16 },
          { header: "Teléfono", value: (p) => p.telefono ?? "", width: 16 },
          { header: "Compras del mes", value: (p) => p.cantidad, formato: "entero", suma: true, width: 15 },
          { header: "Total del mes", value: (p) => p.total, formato: "gs", suma: true, width: 18 },
          { header: "Última compra", value: (p) => (p.ultima_compra ? new Date(p.ultima_compra) : ""), formato: "fecha", width: 14 },
        ],
      }),
      hoja({
        nombre: "Compras por proveedor", filas: conCompras,
        columnas: [
          { header: "Proveedor", value: (p) => p.nombre, width: 34 },
          { header: "Compras del mes", value: (p) => p.cantidad, formato: "entero", suma: true, width: 15 },
          { header: "Total del mes", value: (p) => p.total, formato: "gs", suma: true, width: 18 },
          { header: "Última compra", value: (p) => (p.ultima_compra ? new Date(p.ultima_compra) : ""), formato: "fecha", width: 14 },
        ],
      }),
    ], {
      ...emp, informe: "Proveedores", periodo: mesLabelLargo(mes), sucursal: suc,
      notas: ["La hoja Proveedores lista todos, incluso los que no compraron en el mes; la siguiente deja solo los que tuvieron movimiento."],
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`proveedores-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/proveedores/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
