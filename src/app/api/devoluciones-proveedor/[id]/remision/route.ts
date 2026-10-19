import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4, EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/devoluciones-proveedor/[id]/remision
 * HTML imprimible tipo REMISIÓN para una devolución a proveedor. Mismo formato
 * que la nota de remisión de ventas, pero el destinatario es el proveedor y el
 * título indica que es una DEVOLUCIÓN. Documento no fiscal.
 *   ?auto=1 → dispara window.print() al abrir.
 */
export const dynamic = "force-dynamic";

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return String(iso);
  }
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;

  const devQ = await ctx.supabase
    .from("devoluciones_proveedor")
    .select("id, numero_control, proveedor_id, proveedor_nombre, motivo, total_unidades, fecha, created_at, usuario_nombre, nr_chofer_nombre, nr_chofer_ci, nr_chofer_telefono, nr_transporte_marca, nr_transporte_chapa, nr_transporte_color, receptor_nombre, receptor_telefono")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (devQ.error) return new NextResponse(`Error: ${devQ.error.message}`, { status: 500 });
  if (!devQ.data) return new NextResponse("Devolución no encontrada", { status: 404 });
  const dev = devQ.data as {
    proveedor_id: string | null;
    numero_control: string | null; proveedor_nombre: string | null; motivo: string | null;
    total_unidades: number | null; fecha: string | null; created_at: string | null; usuario_nombre: string | null;
    nr_chofer_nombre: string | null; nr_chofer_ci: string | null; nr_chofer_telefono: string | null;
    nr_transporte_marca: string | null; nr_transporte_chapa: string | null; nr_transporte_color: string | null;
    receptor_nombre: string | null; receptor_telefono: string | null;
  };

  // RUC del proveedor (ya registrado). Se muestra en el destinatario.
  let proveedorRuc: string | null = null;
  if (dev.proveedor_id) {
    const pQ = await ctx.supabase
      .from("proveedores")
      .select("ruc")
      .eq("empresa_id", empresaId)
      .eq("id", dev.proveedor_id)
      .maybeSingle();
    proveedorRuc = (pQ.data as { ruc?: string | null } | null)?.ruc ?? null;
  }

  const itQ = await ctx.supabase
    .from("devoluciones_proveedor_items")
    .select("producto_nombre, producto_sku, cantidad")
    .eq("empresa_id", empresaId)
    .eq("devolucion_id", id);
  if (itQ.error) return new NextResponse(`Error items: ${itQ.error.message}`, { status: 500 });
  const items = (itQ.data ?? []) as Array<{ producto_nombre: string | null; producto_sku: string | null; cantidad: number | null }>;

  const filas = items
    .map((it) => `<tr>
        <td class="cant">${Number(it.cantidad ?? 0)}</td>
        <td class="uni">UNIDAD</td>
        <td class="desc">${escapeHtml(it.producto_nombre)}<span class="sku">${escapeHtml(it.producto_sku ?? "")}</span></td>
      </tr>`)
    .join("");

  const numero = dev.numero_control || "—";
  const fecha = formatFecha(dev.fecha || dev.created_at);
  const motivo = dev.motivo
    ? `<div class="obs"><strong>Motivo:</strong> ${escapeHtml(dev.motivo)}</div>` : "";

  // Chofer / transporte / receptor (documento no fiscal). Solo se muestra la fila
  // si hay al menos un dato cargado.
  const choferHtml = [
    dev.nr_chofer_nombre ? `<div><strong>${escapeHtml(dev.nr_chofer_nombre)}</strong></div>` : "",
    dev.nr_chofer_ci ? `<div>CI: ${escapeHtml(dev.nr_chofer_ci)}</div>` : "",
    dev.nr_chofer_telefono ? `<div>Tel: ${escapeHtml(dev.nr_chofer_telefono)}</div>` : "",
  ].filter(Boolean).join("");
  const transporteHtml = [
    dev.nr_transporte_marca ? `<div>Marca: ${escapeHtml(dev.nr_transporte_marca)}</div>` : "",
    dev.nr_transporte_chapa ? `<div>Chapa: ${escapeHtml(dev.nr_transporte_chapa)}</div>` : "",
    dev.nr_transporte_color ? `<div>Color: ${escapeHtml(dev.nr_transporte_color)}</div>` : "",
  ].filter(Boolean).join("");
  const receptorHtml = [
    dev.receptor_nombre ? `<div><strong>${escapeHtml(dev.receptor_nombre)}</strong></div>` : "",
    dev.receptor_telefono ? `<div>Tel: ${escapeHtml(dev.receptor_telefono)}</div>` : "",
  ].filter(Boolean).join("");
  const transporteRow = choferHtml || transporteHtml || receptorHtml
    ? `<div class="row">
        <div class="box"><h3>Chofer</h3>${choferHtml || "<div>—</div>"}</div>
        <div class="box"><h3>Transporte</h3>${transporteHtml || "<div>—</div>"}</div>
        <div class="box"><h3>Recibe</h3>${receptorHtml || "<div>—</div>"}</div>
      </div>`
    : "";
  const rucEmisor = EMPRESA_DOC.ruc ? `<div><strong>RUC emisor:</strong> ${escapeHtml(EMPRESA_DOC.ruc)}</div>` : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Remisión de devolución ${escapeHtml(numero)} — Roldán e Hijos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:24px; }
  .doc { background:#fff; max-width:720px; margin:0 auto; padding:28px 32px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .titulo { text-align:center; font-weight:800; font-size:15px; border:2px solid #111; padding:6px; margin:12px 0 16px; letter-spacing:2px; }
  .row { display:flex; justify-content:space-between; gap:24px; font-size:13px; margin-bottom:14px; }
  .box { flex:1; border:1px solid #ddd; border-radius:8px; padding:10px 12px; }
  .box h3 { margin:0 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#666; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
  th,td { border:1px solid #ddd; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f6f6f6; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  td.cant, td.uni, th.cant, th.uni { text-align:center; width:64px; white-space:nowrap; }
  td.desc .sku { display:block; font-size:11px; color:#888; font-family:ui-monospace,monospace; }
  .obs { font-size:12px; margin-top:12px; }
  .legal { margin-top:18px; font-size:11px; color:#555; border-top:1px dashed #bbb; padding-top:10px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } }
</style></head>
<body><div class="doc">
  ${membreteA4()}
  <div class="titulo">REMISIÓN — DEVOLUCIÓN A PROVEEDOR</div>
  <div class="row">
    <div class="box"><h3>Documento</h3>
      <div><strong>N°:</strong> ${escapeHtml(numero)}</div>
      <div><strong>Fecha:</strong> ${escapeHtml(fecha)}</div>
      <div><strong>Total unidades:</strong> ${Number(dev.total_unidades ?? 0)}</div>
      ${rucEmisor}
    </div>
    <div class="box"><h3>Proveedor (destinatario)</h3>
      <div><strong>${escapeHtml(dev.proveedor_nombre || "—")}</strong></div>
      ${proveedorRuc ? `<div>RUC: ${escapeHtml(proveedorRuc)}</div>` : ""}
    </div>
  </div>
  ${transporteRow}
  <table>
    <thead><tr><th class="cant">Cant.</th><th class="uni">Unidad</th><th>Descripción</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="3" style="text-align:center;color:#888">Sin ítems</td></tr>`}</tbody>
  </table>
  ${motivo}
  <div class="legal">Documento no fiscal. Emitido para acompañar la devolución de mercaderías al proveedor.</div>
</div>
<script>try{ if (new URL(location.href).searchParams.get('auto')==='1') window.print(); }catch(e){}</script>
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
