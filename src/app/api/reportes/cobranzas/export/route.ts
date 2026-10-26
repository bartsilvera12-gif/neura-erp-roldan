import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { informeCobranzas } from "@/lib/cobros/server/informe-cobranzas";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

/**
 * GET /api/reportes/cobranzas/export → XLSX del informe de cobranzas
 * (punto 10.2 con el requisito 11.1).
 *
 * Mismos filtros que la pantalla, para que la planilla diga exactamente lo que
 * se estaba mirando.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde") ?? "";
    const hasta = sp.get("hasta") ?? "";

    const d = await informeCobranzas(
      ctx.supabase,
      ctx.auth.empresa_id,
      exigirSucursal(ctx.auth.sucursal_id),
      {
        clienteId: sp.get("cliente"),
        desde, hasta,
        metodo: sp.get("metodo"),
        estado: sp.get("estado"),
        q: sp.get("q"),
      }
    );

    const resumen = [
      { concepto: "Reporte", valor: "Cobranzas" },
      { concepto: "Desde", valor: desde || "(sin límite)" },
      { concepto: "Hasta", valor: hasta || "(sin límite)" },
      { concepto: "Cobros", valor: d.resumen.cantidad },
      { concepto: "Total cobrado", valor: d.resumen.total },
      { concepto: "Cobros anulados", valor: d.resumen.anulados },
      { concepto: "Monto anulado (no suma)", valor: d.resumen.total_anulado },
      ...(d.recortado
        ? [{ concepto: "Atención", valor: "El informe llegó al tope de 1000 cobros: acotá el rango de fechas." }]
        : []),
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 30 },
        { header: "Valor", value: (x) => x.valor, width: 60 },
      ]),
      sheetFromRows("Cobros", d.filas, [
        { header: "Fecha", value: (x) => String(x.fecha_pago).slice(0, 10), width: 12 },
        { header: "Cliente", value: (x) => x.cliente_nombre, width: 34 },
        { header: "Factura", value: (x) => x.numero_venta ?? "", width: 16 },
        { header: "Importe", value: (x) => x.monto, width: 16 },
        { header: "Medio", value: (x) => x.metodo_pago, width: 14 },
        { header: "Entidad", value: (x) => x.entidad ?? "", width: 20 },
        { header: "Comprobante", value: (x) => x.referencia ?? "", width: 20 },
        { header: "Cobró", value: (x) => x.usuario_nombre ?? "", width: 22 },
        { header: "Anulado", value: (x) => (x.anulado ? "SÍ" : ""), width: 10 },
        { header: "Motivo de anulación", value: (x) => x.anulado_motivo ?? "", width: 36 },
      ]),
      sheetFromRows("Por cliente", d.resumen.por_cliente, [
        { header: "Cliente", value: (x) => x.nombre, width: 34 },
        { header: "Cobros", value: (x) => x.cantidad, width: 10 },
        { header: "Total", value: (x) => x.total, width: 18 },
      ]),
      sheetFromRows("Por medio de pago", d.resumen.por_metodo, [
        { header: "Medio", value: (x) => x.metodo, width: 18 },
        { header: "Cobros", value: (x) => x.cantidad, width: 10 },
        { header: "Total", value: (x) => x.total, width: 18 },
      ]),
    ]);

    const rango = desde || hasta ? `${desde || "inicio"}_${hasta || "hoy"}` : "todo";
    return new Response(new Uint8Array(buf), { headers: xlsxResponseHeaders(`cobranzas-${rango}.xlsx`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/cobranzas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar la planilla.", { status: 500 });
  }
}
