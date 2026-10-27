import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { informeCobranzas } from "@/lib/cobros/server/informe-cobranzas";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { buildXlsxEstiladoMulti, hoja, formatearGs, formatearCantidad } from "@/lib/excel/estilo";
import { datosEmpresaInforme, nombreSucursal } from "@/lib/excel/encabezado";

/**
 * GET /api/reportes/cobranzas/export → XLSX del informe de cobranzas
 * (punto 10.2 con el requisito 11.1).
 *
 * Mismos filtros que la pantalla, para que la planilla diga exactamente lo que
 * se estaba mirando.
 *
 * ── POR QUÉ LA COLUMNA "IMPORTE" NO SE TOTALIZA ───────────────────────────
 *   El detalle incluye los cobros anulados, marcados como tales, porque hace
 *   falta verlos para saber qué se deshizo y por qué. Pero un anulado no es
 *   plata que entró: sumar la columna entera daría una cobranza más alta que
 *   la real. El total que sirve está en la hoja "Resumen", donde lo cobrado y
 *   lo anulado van en renglones separados.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde") ?? "";
    const hasta = sp.get("hasta") ?? "";
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const d = await informeCobranzas(ctx.supabase, ctx.auth.empresa_id, sucursalId, {
      clienteId: sp.get("cliente"),
      desde, hasta,
      metodo: sp.get("metodo"),
      estado: sp.get("estado"),
      q: sp.get("q"),
    });
    const [emp, suc] = await Promise.all([datosEmpresaInforme(ctx.auth.empresa_id), nombreSucursal(sucursalId)]);

    const resumen = [
      { concepto: "Cobros", valor: formatearCantidad(d.resumen.cantidad) },
      { concepto: "Total cobrado", valor: formatearGs(d.resumen.total) },
      { concepto: "Cobros anulados", valor: formatearCantidad(d.resumen.anulados) },
      { concepto: "Monto anulado (no suma)", valor: formatearGs(d.resumen.total_anulado) },
      ...(d.recortado
        ? [{ concepto: "Atención", valor: "El informe llegó al tope de 1000 cobros: acotá el rango de fechas." }]
        : []),
    ];

    const buf = await buildXlsxEstiladoMulti([
      hoja({
        nombre: "Resumen", filas: resumen, sinFiltro: true, totales: false,
        columnas: [
          { header: "Concepto", value: (x) => x.concepto, width: 30 },
          { header: "Valor", value: (x) => x.valor, width: 60 },
        ],
      }),
      hoja({
        nombre: "Cobros", filas: d.filas, totales: false,
        columnas: [
          { header: "Fecha", value: (x) => String(x.fecha_pago).slice(0, 10), width: 12 },
          { header: "Cliente", value: (x) => x.cliente_nombre, width: 34 },
          { header: "Factura", value: (x) => x.numero_venta ?? "", width: 16 },
          { header: "Importe", value: (x) => x.monto, formato: "gs", width: 17 },
          { header: "Medio", value: (x) => x.metodo_pago, width: 15 },
          { header: "Entidad", value: (x) => x.entidad ?? "", width: 22 },
          { header: "Comprobante", value: (x) => x.referencia ?? "", width: 20 },
          { header: "Cobró", value: (x) => x.usuario_nombre ?? "", width: 24 },
          { header: "Anulado", value: (x) => (x.anulado ? "SÍ" : ""), width: 10 },
          { header: "Motivo de anulación", value: (x) => x.anulado_motivo ?? "", width: 38 },
        ],
      }),
      hoja({
        nombre: "Por cliente", filas: d.resumen.por_cliente,
        columnas: [
          { header: "Cliente", value: (x) => x.nombre, width: 34 },
          { header: "Cobros", value: (x) => x.cantidad, formato: "entero", suma: true, width: 11 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 18 },
        ],
      }),
      hoja({
        nombre: "Por medio de pago", filas: d.resumen.por_metodo,
        columnas: [
          { header: "Medio", value: (x) => x.metodo, width: 18 },
          { header: "Cobros", value: (x) => x.cantidad, formato: "entero", suma: true, width: 11 },
          { header: "Total", value: (x) => x.total, formato: "gs", suma: true, width: 18 },
        ],
      }),
    ], {
      ...emp, informe: "Cobranzas", sucursal: suc,
      periodo: desde || hasta ? `Del ${desde || "inicio"} al ${hasta || "hoy"}` : "Todas las fechas",
      notas: ["La hoja Cobros incluye los anulados, marcados en su columna; por eso no se totaliza el importe. El total cobrado está en el Resumen."],
    });

    const rango = desde || hasta ? `${desde || "inicio"}_${hasta || "hoy"}` : "todo";
    return new Response(new Uint8Array(buf), { headers: xlsxResponseHeaders(`cobranzas-${rango}`) });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/cobranzas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar la planilla.", { status: 500 });
  }
}
