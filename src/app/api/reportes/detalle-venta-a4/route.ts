import { NextRequest, NextResponse } from "next/server";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { EMPRESA_DOC, membreteLinea } from "@/lib/documentos/membrete";

/**
 * GET /api/reportes/detalle-venta-a4?desde=&hasta=
 *
 * El "Detalle de Venta" con el formato del sistema anterior del cliente: una
 * fila por factura con el importe repartido en las columnas de contado,
 * crédito y medio de cobro, y el bloque de totales al pie.
 *
 * Es la hoja contra la que su gente controla el día: por eso las columnas y
 * los rótulos son los de siempre y no los que se nos ocurrirían ahora.
 */

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Paraguay es UTC−3 todo el año; el offset va escrito porque la tzdata del server puede estar vieja. */
function fechaHoraPy(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}:${p(py.getUTCSeconds())}`;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return new NextResponse("No autorizado", { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);

    const sp = new URL(request.url).searchParams;
    const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : hoy;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : desde;

    // Paginado: un mes de esta casa tiene más de mil ventas y PostgREST
    // devolvía las primeras mil como si fueran todas.
    const vq = {
      data: await traerTodas<Record<string, unknown>>((d, h) =>
        ctx.supabase
          .from("ventas")
          .select("numero_control, fecha, total, estado, tipo_venta, metodo_pago, cliente_nombre, usuario_nombre, vendedor_nombre")
          .eq("empresa_id", empresaId)
          .eq("sucursal_id", sucursalId)
          .gte("fecha", `${desde}T00:00:00-03:00`)
          .lte("fecha", `${hasta}T23:59:59.999-03:00`)
          .order("fecha", { ascending: false })
          .order("id", { ascending: true })
          .range(d, h)
      ),
    };

    type V = {
      numero_control?: string | null; fecha?: string; total?: number | string;
      estado?: string | null; tipo_venta?: string | null; metodo_pago?: string | null;
      cliente_nombre?: string | null; vendedor_nombre?: string | null; usuario_nombre?: string | null;
    };
    const ventas = (vq.data ?? []) as unknown as V[];

    const anulada = (v: V) => String(v.estado ?? "") === "anulada";
    const credito = (v: V) => String(v.tipo_venta ?? "").toUpperCase() === "CREDITO";
    const medio = (v: V) => String(v.metodo_pago ?? "").toLowerCase();

    // Los totales del pie, con los mismos rótulos del formato de la casa.
    let totalVenta = 0, aCredito = 0, efectivo = 0, cheque = 0, tarjeta = 0, deposito = 0, anuladas = 0;
    for (const v of ventas) {
      const monto = Number(v.total) || 0;
      if (anulada(v)) { anuladas += monto; continue; }
      totalVenta += monto;
      if (credito(v)) { aCredito += monto; continue; }
      const m = medio(v);
      if (m === "efectivo") efectivo += monto;
      else if (m === "cheque") cheque += monto;
      else if (m === "tarjeta") tarjeta += monto;
      else if (m === "transferencia") deposito += monto;
      else efectivo += monto;
    }

    const filas = ventas.map((v, i) => {
      const monto = Number(v.total) || 0;
      const esAnu = anulada(v);
      const m = medio(v);
      const col = (cond: boolean) => (cond && !esAnu ? gs(monto) : "");
      return `<tr${esAnu ? ' class="anul"' : ""}>
        <td class="n">${ventas.length - i}</td>
        <td class="fac">${esc(v.numero_control ?? "")}</td>
        <td class="t">${credito(v) ? "C" : "D"}</td>
        <td>${esc(v.cliente_nombre ?? "Sin cliente")}${esAnu ? ' <span class="tag">ANULADA</span>' : ""}</td>
        <td class="m">${col(!credito(v))}</td>
        <td class="m">${col(credito(v))}</td>
        <td class="m">${col(!credito(v) && (m === "efectivo" || m === ""))}</td>
        <td class="m">${col(m === "cheque")}</td>
        <td class="m">${col(m === "tarjeta")}</td>
        <td class="m">${col(m === "transferencia")}</td>
      </tr>`;
    }).join("");

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle de Venta — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 10mm; font-size: 10px; }
  .print-btn { position: fixed; top: 12px; right: 12px; z-index: 10; background: #4FAEB2;
    color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  @media print { .print-btn { display: none; } }
  .cab { display: flex; justify-content: space-between; align-items: baseline; }
  h1 { font-size: 16px; margin: 0; }
  .momento { font-size: 10px; }
  .cab2 { display: flex; justify-content: space-between; font-size: 10px;
          border-bottom: 1.5px solid #000; padding-bottom: 5px; margin: 4px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { border-bottom: 1.2px solid #000; padding: 3px 4px; font-size: 9px; text-align: left; }
  td { padding: 2px 4px; font-size: 9px; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  .m { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .n { width: 42px; color: #666; }
  .fac { width: 62px; font-variant-numeric: tabular-nums; }
  .t { width: 16px; text-align: center; font-weight: 700; }
  /* Una anulada se declara pero no suma: su importe va tachado y las columnas
     de cobro quedan vacías, porque esa plata no entró. */
  .anul td { color: #777; }
  .tag { border: 1px solid #999; padding: 0 3px; font-size: 8px; font-weight: 700; }
  .totales { margin-top: 12px; display: flex; gap: 10mm; }
  .totales table { width: 100%; }
  .totales td { border: 0; padding: 1.5px 3px; font-size: 10px; }
  .totales tr.fuerte td { border-top: 1.2px solid #000; font-weight: 700; padding-top: 4px; }
  .nota { margin-top: 10px; font-size: 9px; color: #555; line-height: 1.5; }
  .vacio { text-align: center; color: #888; padding: 10px; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>
  ${membreteLinea()}
  <div class="cab">
    <h1>Detalle de Venta</h1>
    <div class="momento">${esc(fechaHoraPy(new Date().toISOString()))}</div>
  </div>
  <div class="cab2">
    <div><b>Período:</b> ${esc(desde.split("-").reverse().join("/"))} al ${esc(hasta.split("-").reverse().join("/"))}</div>
    <div><b>Comprobantes:</b> ${ventas.length}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="n">Ref.</th>
        <th class="fac">Factura</th>
        <th class="t">T</th>
        <th>Cliente</th>
        <th class="m">Contado</th>
        <th class="m">Crédito</th>
        <th class="m">Efectivo</th>
        <th class="m">Cheque</th>
        <th class="m">Tarjeta</th>
        <th class="m">Dep. B</th>
      </tr>
    </thead>
    <tbody>
      ${filas || '<tr><td colspan="10" class="vacio">No hubo ventas en el período.</td></tr>'}
    </tbody>
  </table>

  <div class="totales">
    <table>
      <tbody>
        <tr><td>TOTAL DE VENTA</td><td class="m">${gs(totalVenta)}</td></tr>
        <tr><td>VENTA A CREDITO</td><td class="m">${gs(aCredito)}</td></tr>
        <tr><td>CHEQUE VENTA</td><td class="m">${gs(cheque)}</td></tr>
        <tr><td>TARJETA</td><td class="m">${gs(tarjeta)}</td></tr>
        <tr><td>DEPOSITO BANCARIO (GIRO)</td><td class="m">${gs(deposito)}</td></tr>
        <tr><td>VENTA ANULADA</td><td class="m">${gs(anuladas)}</td></tr>
      </tbody>
    </table>
    <table>
      <tbody>
        <tr><td>VENTA CONTADO</td><td class="m">${gs(totalVenta - aCredito)}</td></tr>
        <tr><td>EFECTIVO</td><td class="m">${gs(efectivo)}</td></tr>
        <tr class="fuerte"><td>TOTAL COBRADO EN EFECTIVO</td><td class="m">${gs(efectivo)}</td></tr>
      </tbody>
    </table>
  </div>

  <p class="nota">
    La columna <b>T</b> dice si la venta fue a crédito (C) o de contado (D). Las anuladas se
    listan para que el numerador de comprobantes cierre, con su importe aparte: esa plata no
    entró. Las ventas a crédito son facturación pero no efectivo del día.
  </p>

  ${sp.get("auto") === "1" ? "<script>window.addEventListener('load',()=>window.print())</script>" : ""}
</body>
</html>`;

    return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/detalle-venta-a4]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el detalle de venta.", { status: 500 });
  }
}
