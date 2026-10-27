import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteVentas } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, formatearCantidad } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

const TP_LABEL: Record<string, string> = { minorista: "Minorista", mayorista: "Mayorista", distribuidor: "Distribuidor", costo: "Al costo" };

/** GET /api/reportes/ventas/export?mes=YYYY-MM → XLSX (Resumen + Por tipo de precio + Por producto + Ventas + Items). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const r = await getReporteVentas(schema, ctx.auth.empresa_id, sucursalId, { mes, start, end, mesInicio: `${mes}-01` });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Total vendido", valor: formatearGs(r.totalVendido) },
      { concepto: "Cantidad de ventas", valor: formatearCantidad(r.cantidadVentas) },
      { concepto: "Cantidad de ítems (líneas)", valor: formatearCantidad(r.cantidadItems) },
      { concepto: "Ticket promedio", valor: formatearGs(r.ticketPromedio) },
      { concepto: "Unidades vendidas", valor: formatearCantidad(r.unidadesVendidas) },
    ];

    const tipoRows = (["minorista", "mayorista", "distribuidor", "costo"] as const).map((t) => ({
      tipo: TP_LABEL[t], items: r.porTipoPrecio[t].items, total: r.porTipoPrecio[t].total,
    }));

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 32 },
          { header: "Valor", value: (x) => x.valor, width: 24 },
        ],
      }),
      hoja({
        nombre: "Por tipo de precio", filas: tipoRows,
        columnas: [
          { header: "Tipo de precio", value: (x) => x.tipo, width: 16 },
          { header: "Ítems", value: (x) => x.items, formato: "entero", suma: true, width: 11 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Por producto", filas: r.porProducto,
        columnas: [
          { header: "Producto", value: (x) => x.producto_nombre, width: 38 },
          { header: "Cantidad", value: (x) => x.cantidad, formato: "cantidad", suma: true, width: 12 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Ventas", filas: r.ventas,
        columnas: [
          { header: "Fecha", value: (v) => (v.fecha ? new Date(v.fecha) : ""), formato: "fecha", width: 12 },
          { header: "N° venta", value: (v) => v.numero_control, width: 16 },
          { header: "Cliente", value: (v) => v.cliente ?? "", width: 30 },
          { header: "Método de pago", value: (v) => v.metodo_pago ?? "", width: 16 },
          { header: "Ítems", value: (v) => v.items_count, formato: "entero", suma: true, width: 9 },
          { header: "Total", value: (v) => v.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Items vendidos", filas: r.items,
        columnas: [
          { header: "Fecha", value: (i) => (i.fecha ? new Date(i.fecha) : ""), formato: "fecha", width: 12 },
          { header: "N° venta", value: (i) => i.numero_control, width: 16 },
          { header: "Producto", value: (i) => i.producto_nombre, width: 38 },
          { header: "Tipo de precio", value: (i) => TP_LABEL[i.tipo_precio] ?? i.tipo_precio, width: 15 },
          { header: "Cantidad", value: (i) => i.cantidad, formato: "cantidad", suma: true, width: 11 },
          { header: "Precio unit.", value: (i) => i.precio_venta, formato: "gs", width: 15 },
          { header: "Subtotal", value: (i) => i.subtotal, formato: "gs", suma: true, width: 15 },
          { header: "IVA", value: (i) => i.monto_iva, formato: "gs", suma: true, width: 14 },
          { header: "Total línea", value: (i) => i.total_linea, formato: "gs", suma: true, width: 16 },
        ],
      }),
    ], {
      ...emp, informe: "Ventas del mes", periodo: mesLabelLargo(mes), sucursal: suc,
      notas: ["Excluye ventas anuladas."],
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`ventas-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/ventas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
