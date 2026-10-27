import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteCompras } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes, mesLabelLargo } from "@/lib/fechas/asuncion-bounds";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, formatearCantidad } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

/** GET /api/reportes/compras/export?mes=YYYY-MM → XLSX (Resumen + Por proveedor + Por producto + Compras + Items). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const r = await getReporteCompras(schema, ctx.auth.empresa_id, sucursalId, { mes, start, end, mesInicio: `${mes}-01` });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Total comprado", valor: formatearGs(r.totalComprado) },
      { concepto: "Cantidad de compras", valor: formatearCantidad(r.cantidad) },
      { concepto: "Cantidad de ítems (líneas)", valor: formatearCantidad(r.cantidadItems) },
      { concepto: "Compra más alta", valor: r.compraMasAlta ? `${r.compraMasAlta.numero_control} · ${r.compraMasAlta.proveedor_nombre} (${formatearGs(r.compraMasAlta.total)})` : "—" },
      { concepto: "Proveedor con mayor monto", valor: r.proveedorMayor ? `${r.proveedorMayor.proveedor_nombre} (${formatearGs(r.proveedorMayor.total)})` : "—" },
      { concepto: "Producto más comprado (cant.)", valor: r.productoMasComprado ? `${r.productoMasComprado.producto_nombre} (${formatearCantidad(r.productoMasComprado.cantidad)})` : "—" },
      { concepto: "Producto con mayor gasto", valor: r.productoMayorGasto ? `${r.productoMayorGasto.producto_nombre} (${formatearGs(r.productoMayorGasto.gasto)})` : "—" },
    ];

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 32 },
          { header: "Valor", value: (x) => x.valor, width: 50 },
        ],
      }),
      hoja({
        nombre: "Por proveedor", filas: r.porProveedor,
        columnas: [
          { header: "Proveedor", value: (x) => x.proveedor_nombre, width: 34 },
          { header: "Compras", value: (x) => x.compras, formato: "entero", suma: true, width: 11 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Por producto", filas: r.porProducto,
        columnas: [
          { header: "Producto", value: (x) => x.producto_nombre, width: 38 },
          { header: "Cantidad", value: (x) => x.cantidad, formato: "cantidad", suma: true, width: 12 },
          { header: "Gasto", value: (x) => x.gasto, formato: "gs", suma: true, width: 17 },
        ],
      }),
      hoja({
        nombre: "Compras", filas: r.compras,
        columnas: [
          { header: "Fecha", value: (c) => (c.fecha ? new Date(c.fecha) : ""), formato: "fecha", width: 12 },
          { header: "N° compra", value: (c) => c.numero_control, width: 16 },
          { header: "Proveedor", value: (c) => c.proveedor_nombre, width: 32 },
          { header: "Ítems", value: (c) => c.items_count, formato: "entero", suma: true, width: 9 },
          { header: "Subtotal", value: (c) => c.subtotal, formato: "gs", suma: true, width: 15 },
          { header: "IVA", value: (c) => c.monto_iva, formato: "gs", suma: true, width: 14 },
          { header: "Total", value: (c) => c.total, formato: "gs", suma: true, width: 16 },
          { header: "Tipo de pago", value: (c) => c.tipo_pago, width: 14 },
          { header: "Timbrado", value: (c) => c.nro_timbrado ?? "", width: 18 },
          { header: "Comprobante", value: (c) => (c.tiene_comprobante ? "Sí" : "No"), width: 13 },
        ],
      }),
      hoja({
        nombre: "Items comprados", filas: r.items,
        columnas: [
          { header: "Fecha", value: (i) => (i.fecha ? new Date(i.fecha) : ""), formato: "fecha", width: 12 },
          { header: "N° compra", value: (i) => i.numero_control, width: 16 },
          { header: "Proveedor", value: (i) => i.proveedor_nombre, width: 32 },
          { header: "Producto", value: (i) => i.producto_nombre, width: 38 },
          { header: "Cantidad", value: (i) => i.cantidad, formato: "cantidad", suma: true, width: 11 },
          { header: "Costo unit.", value: (i) => i.costo_unitario, formato: "gs", width: 15 },
          { header: "Total línea", value: (i) => i.total_linea, formato: "gs", suma: true, width: 16 },
        ],
      }),
    ], {
      ...emp, informe: "Compras del mes", periodo: mesLabelLargo(mes), sucursal: suc,
    });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`compras-${mes}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/compras/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
