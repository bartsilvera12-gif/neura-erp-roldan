import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

export const dynamic = "force-dynamic";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function gs(v: unknown, moneda?: string): string {
  const pre = moneda === "USD" ? "USD " : "Gs. ";
  return pre + Math.round(n(v)).toLocaleString("es-PY");
}
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fecha(v: unknown): string {
  const s = String(v ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "—");
}
function hoyYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
};

/** GET /api/compras/orden-pago?numero_control=COMP-XXXXXX — orden de pago imprimible (HTML A4). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const numeroControl = (new URL(request.url).searchParams.get("numero_control") ?? "").trim();
  if (!numeroControl) return new NextResponse("numero_control obligatorio", { status: 400 });

  const { data, error } = await ctx.supabase
    .from("compras")
    .select("numero_control, proveedor_id, proveedor_nombre, numero_factura, nro_timbrado, fecha, fecha_factura, plazo_dias, tipo_pago, estado, metodo_pago, referencia_pago, fecha_pago, moneda, producto_nombre, cantidad, iva_tipo, total")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("numero_control", numeroControl)
    .order("created_at", { ascending: true });
  if (error) return new NextResponse(`Error: ${error.message}`, { status: 500 });
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return new NextResponse("Compra no encontrada", { status: 404 });

  const h = rows[0];
  const moneda = String(h.moneda ?? "PYG");
  const totalCompra = rows.reduce((a, r) => a + n(r.total), 0);
  const fechaBase = (h.fecha_factura ? String(h.fecha_factura) : (h.fecha ? String(h.fecha) : "")).slice(0, 10);
  const plazo = h.plazo_dias != null ? Number(h.plazo_dias) : null;
  const vencimiento = fechaBase && plazo != null ? addDaysISO(fechaBase, plazo) : null;
  const pagada = h.estado === "pagada";

  // RUC / dirección del proveedor (si está registrado).
  let ruc = "";
  if (h.proveedor_id) {
    const p = await ctx.supabase
      .from("proveedores")
      .select("ruc")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", String(h.proveedor_id))
      .maybeSingle();
    ruc = (p.data?.ruc as string) ?? "";
  }

  const filaItem = (r: Record<string, unknown>) => `
    <tr>
      <td>${esc(r.producto_nombre)}</td>
      <td style="text-align:right;">${n(r.cantidad).toLocaleString("es-PY")}</td>
      <td style="text-align:center;">${r.iva_tipo === "5" ? "5%" : r.iva_tipo === "10" ? "10%" : "Ex."}</td>
      <td style="text-align:right;">${gs(r.total, moneda)}</td>
    </tr>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Orden de pago ${esc(numeroControl)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; padding: 24px; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 10px 0 2px; text-align: center; letter-spacing: 1px; }
  .sub { font-size: 12px; color: #6b7280; text-align: center; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12.5px; margin: 14px 0 18px; }
  .grid div span { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 8px; }
  th { text-align: left; background: #f3f4f6; padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .tot { display: flex; justify-content: space-between; font-weight: 800; font-size: 16px; padding: 8px; background: #ecfdf5; border-radius: 6px; margin-top: 4px; }
  .pago { margin-top: 14px; font-size: 12.5px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
  .foot { margin-top: 54px; display: flex; justify-content: space-around; font-size: 12px; }
  .firma { border-top: 1px solid #9ca3af; padding-top: 4px; width: 240px; text-align: center; }
  .estado { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
  .estado.pagada { background:#ecfdf5; color:#047857; }
  .estado.pend { background:#fff7ed; color:#c2410c; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  ${membreteA4()}

  <h1>ORDEN DE PAGO</h1>
  <div class="sub">N° ${esc(numeroControl)} · Emitida el ${fecha(hoyYmd())}
    <span class="estado ${pagada ? "pagada" : "pend"}">${pagada ? "PAGADA" : "PENDIENTE"}</span>
  </div>

  <div class="grid">
    <div><span>Proveedor:</span> <strong>${esc(h.proveedor_nombre)}</strong></div>
    <div><span>RUC:</span> ${esc(ruc) || "—"}</div>
    <div><span>N° de factura:</span> ${esc(h.numero_factura) || "—"}</div>
    <div><span>N° de timbrado:</span> ${esc(h.nro_timbrado) || "—"}</div>
    <div><span>Fecha de factura:</span> ${fecha(h.fecha_factura)}</div>
    <div><span>Condición:</span> ${h.tipo_pago === "credito" ? `Crédito${plazo != null ? ` · ${plazo} días` : ""}` : "Contado"}</div>
    <div><span>Vencimiento:</span> ${fecha(vencimiento)}</div>
    <div><span>Moneda:</span> ${moneda === "USD" ? "Dólares (USD)" : "Guaraníes"}</div>
  </div>

  <table>
    <thead><tr><th>Concepto</th><th style="text-align:right;">Cant.</th><th style="text-align:center;">IVA</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>${rows.map(filaItem).join("")}</tbody>
  </table>
  <div class="tot"><span>TOTAL A PAGAR</span><span>${gs(totalCompra, moneda)}</span></div>

  ${pagada ? `
  <div class="pago">
    <strong>Pago registrado</strong> — Método: ${esc(METODO_LABEL[String(h.metodo_pago ?? "")] ?? h.metodo_pago ?? "—")}
    ${h.referencia_pago ? ` · N° comprobante/ticket: ${esc(h.referencia_pago)}` : ""}
    ${h.fecha_pago ? ` · Fecha de pago: ${fecha(h.fecha_pago)}` : ""}
  </div>` : ""}

  <div class="foot">
    <div class="firma">Autorizado por</div>
    <div class="firma">Recibí conforme (proveedor)</div>
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center;">
    <button onclick="window.print()" style="background:#0EA5E9;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
</div>
<script>window.addEventListener("load", () => { try { window.print(); } catch (e) {} });</script>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
