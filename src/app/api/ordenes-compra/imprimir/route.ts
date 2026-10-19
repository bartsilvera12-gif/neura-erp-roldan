import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

export const dynamic = "force-dynamic";

function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function money(v: unknown, m?: string): string { return (m === "USD" ? "USD " : "Gs. ") + Math.round(n(v)).toLocaleString("es-PY"); }
function esc(v: unknown): string { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function fecha(v: unknown): string { const s = String(v ?? "").slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || "—"); }

type Item = { descripcion?: unknown; cantidad?: unknown; unidad?: unknown; precio_unitario?: unknown };

/** GET /api/ordenes-compra/imprimir?id=... — orden de compra imprimible (HTML A4). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return new NextResponse("id obligatorio", { status: 400 });

  const { data, error } = await ctx.supabase
    .from("ordenes_compra").select("*")
    .eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle();
  if (error) return new NextResponse(`Error: ${error.message}`, { status: 500 });
  if (!data) return new NextResponse("Orden no encontrada", { status: 404 });

  const o = data as Record<string, unknown>;
  const moneda = String(o.moneda ?? "PYG");
  const items = (Array.isArray(o.items) ? o.items : []) as Item[];
  const total = items.reduce((a, it) => a + n(it.cantidad) * n(it.precio_unitario), 0);

  let ruc = "";
  if (o.proveedor_id) {
    const p = await ctx.supabase.from("proveedores").select("ruc")
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", String(o.proveedor_id)).maybeSingle();
    ruc = (p.data?.ruc as string) ?? "";
  }

  const fila = (it: Item) => `
    <tr>
      <td>${esc(it.descripcion)}</td>
      <td style="text-align:right;">${n(it.cantidad).toLocaleString("es-PY")}</td>
      <td>${esc(it.unidad)}</td>
      <td style="text-align:right;">${n(it.precio_unitario) > 0 ? money(it.precio_unitario, moneda) : "—"}</td>
      <td style="text-align:right;">${n(it.precio_unitario) > 0 ? money(n(it.cantidad) * n(it.precio_unitario), moneda) : "—"}</td>
    </tr>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Orden de compra ${esc(o.numero_control)}</title>
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
  .tot { display: flex; justify-content: space-between; font-weight: 800; font-size: 15px; padding: 8px; background: #eff6ff; border-radius: 6px; margin-top: 4px; }
  .obs { margin-top: 14px; font-size: 12.5px; }
  .foot { margin-top: 54px; display: flex; justify-content: space-around; font-size: 12px; }
  .firma { border-top: 1px solid #9ca3af; padding-top: 4px; width: 240px; text-align: center; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  ${membreteA4()}

  <h1>ORDEN DE COMPRA</h1>
  <div class="sub">N° ${esc(o.numero_control)} · Fecha ${fecha(o.fecha)}</div>

  <div class="grid">
    <div><span>Proveedor:</span> <strong>${esc(o.proveedor_nombre)}</strong></div>
    <div><span>RUC:</span> ${esc(ruc) || "—"}</div>
    <div><span>Moneda:</span> ${moneda === "USD" ? "Dólares (USD)" : "Guaraníes"}</div>
    <div><span>Estado:</span> ${esc(o.estado)}</div>
  </div>

  <p style="font-size:12.5px;color:#374151;margin:0 0 8px;">Solicitamos el despacho de los siguientes productos:</p>
  <table>
    <thead><tr><th>Descripción</th><th style="text-align:right;">Cant.</th><th>Unidad</th><th style="text-align:right;">Precio unit.</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>${items.map(fila).join("")}</tbody>
  </table>
  ${total > 0 ? `<div class="tot"><span>TOTAL ESTIMADO</span><span>${money(total, moneda)}</span></div>` : ""}

  ${o.observaciones ? `<div class="obs"><strong>Observaciones:</strong> ${esc(o.observaciones)}</div>` : ""}

  <div class="foot">
    <div class="firma">Solicitado por</div>
    <div class="firma">Recibido proveedor</div>
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center;">
    <button onclick="window.print()" style="background:#0EA5E9;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
</div>
<script>window.addEventListener("load", () => { try { window.print(); } catch (e) {} });</script>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
