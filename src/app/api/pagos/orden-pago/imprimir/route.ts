import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/pagos/orden-pago/imprimir?cheque_id=… — la orden de pago en A4.
 *
 * ── PARA QUÉ SIRVE ESTE PAPEL ──────────────────────────────────────────────
 *   Joaquín: "hay proveedores que traspapelan los documentos, entonces te
 *   piden de vuelta el cobro de esa factura como que vos estabas deudando".
 *
 *   Esta hoja dice, en un solo lugar: qué cheque, de qué banco, por cuánto, y
 *   QUÉ FACTURAS cubre, una por una con su número y su importe. Abajo, el
 *   espacio donde el proveedor escribe el número de su recibo y firma.
 *
 *   Se imprime en dos: una queda firmada en la carpeta, la otra se la lleva
 *   el proveedor. Si más adelante reclama una de esas facturas, la hoja
 *   firmada la nombra.
 */

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const gs = (v: unknown, moneda?: string): string =>
  `${moneda === "USD" ? "US$ " : "Gs. "}${Math.round(n(v)).toLocaleString("es-PY")}`;
const fecha = (v: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const id = (new URL(request.url).searchParams.get("cheque_id") ?? "").trim();
  if (!id) return new NextResponse("cheque_id obligatorio", { status: 400 });

  const empresaId = ctx.auth.empresa_id;

  // El script 70 agrega las columnas del recibo; sin él se imprime igual, con
  // el espacio en blanco para completarlo a mano.
  let cheque: Record<string, unknown> | null = null;
  const conRecibo = await ctx.supabase
    .from("cheques")
    .select("id, numero, numero_recibo, fecha_recibo, banco_nombre, moneda, importe, estado, fecha_emision, fecha_pago_prevista, proveedor_nombre, observacion")
    .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (conRecibo.error && /recibo/.test(conRecibo.error.message)) {
    const sin = await ctx.supabase
      .from("cheques")
      .select("id, numero, banco_nombre, moneda, importe, estado, fecha_emision, fecha_pago_prevista, proveedor_nombre, observacion")
      .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
    cheque = sin.data as Record<string, unknown> | null;
  } else {
    cheque = conRecibo.data as Record<string, unknown> | null;
  }
  if (!cheque) return new NextResponse("Cheque no encontrado", { status: 404 });

  const ccQ = await ctx.supabase
    .from("cheque_compras")
    .select("compra_numero_control, importe_imputado")
    .eq("empresa_id", empresaId).eq("cheque_id", id).limit(500);
  const imputadas = (ccQ.data ?? []) as Array<Record<string, unknown>>;
  const numeros = imputadas.map((r) => String(r.compra_numero_control ?? "")).filter(Boolean);

  const datos = new Map<string, { numero_factura: string | null; fecha: string | null }>();
  if (numeros.length > 0) {
    const q = await ctx.supabase
      .from("compras")
      .select("numero_control, numero_factura, fecha, fecha_factura")
      .eq("empresa_id", empresaId)
      .in("numero_control", numeros.slice(0, 200));
    for (const r of (q.data ?? []) as Array<Record<string, unknown>>) {
      const nc = String(r.numero_control ?? "");
      if (datos.has(nc)) continue;
      datos.set(nc, {
        numero_factura: r.numero_factura == null ? null : String(r.numero_factura),
        fecha: String(r.fecha_factura ?? r.fecha ?? "").slice(0, 10) || null,
      });
    }
  }

  const moneda = String(cheque.moneda ?? "PYG");
  const filas = imputadas.map((r) => {
    const nc = String(r.compra_numero_control ?? "");
    const d = datos.get(nc);
    return `<tr>
      <td>${esc(d?.numero_factura ?? "—")}</td>
      <td>${esc(nc)}</td>
      <td>${fecha(d?.fecha)}</td>
      <td class="der">${gs(r.importe_imputado, moneda)}</td>
    </tr>`;
  }).join("");

  const totalImputado = imputadas.reduce((s, r) => s + n(r.importe_imputado), 0);
  const numeroRecibo = cheque.numero_recibo ? String(cheque.numero_recibo) : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/>
<title>Orden de pago ${esc(cheque.numero ?? "")}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 14px; }
  .caja { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; }
  .et { font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .va { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10.5px;
       text-transform: uppercase; letter-spacing: .03em; border-bottom: 1px solid #d1d5db; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  .der { text-align: right; }
  tfoot td { font-weight: 700; border-top: 2px solid #9ca3af; border-bottom: none; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 34px; }
  .linea { border-top: 1px solid #9ca3af; padding-top: 5px; text-align: center; font-size: 10.5px; color: #4b5563; }
  .recibo { margin-top: 20px; border: 1px dashed #9ca3af; border-radius: 6px; padding: 10px 12px; }
  .nota { margin-top: 14px; font-size: 10px; color: #6b7280; line-height: 1.5; }
  @media print { .noprint { display: none; } }
</style></head><body>
${membreteA4(new URL(request.url).origin)}

<h1>Orden de pago</h1>
<p class="sub">Comprobante de pago a proveedor · ${esc(cheque.proveedor_nombre ?? "")}</p>

<div class="caja"><div class="grid">
  <div><div class="et">Cheque N°</div><div class="va">${esc(cheque.numero ?? "—")}</div></div>
  <div><div class="et">Banco</div><div class="va">${esc(cheque.banco_nombre ?? "—")}</div></div>
  <div><div class="et">Fecha de pago</div><div class="va">${fecha(cheque.fecha_pago_prevista ?? cheque.fecha_emision)}</div></div>
  <div><div class="et">Importe</div><div class="va">${gs(cheque.importe, moneda)}</div></div>
</div></div>

<table>
  <thead><tr>
    <th>N° de factura</th><th>N° de carga</th><th>Fecha</th><th class="der">Importe</th>
  </tr></thead>
  <tbody>${filas || '<tr><td colspan="4">Sin facturas imputadas.</td></tr>'}</tbody>
  <tfoot><tr>
    <td colspan="3">Total del pago</td>
    <td class="der">${gs(totalImputado, moneda)}</td>
  </tr></tfoot>
</table>

${cheque.observacion ? `<p class="nota">${esc(cheque.observacion)}</p>` : ""}

<!-- El bloque que firma el proveedor. Si el recibo ya se cargó, sale impreso;
     si no, va en blanco para completarlo a mano al entregar el cheque. -->
<div class="recibo">
  <div class="et">Recibí conforme</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
    <div><div class="et">N° de recibo del proveedor</div>
      <div class="va">${numeroRecibo ? esc(numeroRecibo) : "&nbsp;"}</div>
      ${numeroRecibo ? "" : '<div style="border-bottom:1px solid #9ca3af;height:14px;"></div>'}
    </div>
    <div><div class="et">Fecha</div>
      <div class="va">${cheque.fecha_recibo ? fecha(cheque.fecha_recibo) : "&nbsp;"}</div>
      ${cheque.fecha_recibo ? "" : '<div style="border-bottom:1px solid #9ca3af;height:14px;"></div>'}
    </div>
  </div>
</div>

<div class="firmas">
  <div class="linea">Entregó — ${esc(ctx.auth.user?.email ?? "")}</div>
  <div class="linea">Recibió — aclaración, C.I. y sello</div>
</div>

<p class="nota">
  Este comprobante detalla las facturas canceladas con el cheque N° ${esc(cheque.numero ?? "")}.
  Conservar una copia firmada: es la constancia de que estas facturas quedaron pagadas.
</p>

<p class="noprint" style="margin-top:16px;">
  <button onclick="window.print()" style="padding:8px 14px;font-size:12px;cursor:pointer;">Imprimir</button>
</p>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 350); });</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
