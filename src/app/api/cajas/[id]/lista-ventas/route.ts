import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal } from "@/lib/sucursales/filtro";
import { getDetalleCaja } from "@/lib/caja/server";
import { EMPRESA_DOC, membreteLinea } from "@/lib/documentos/membrete";
import { htmlConSucursal } from "@/lib/documentos/server/membrete-sucursal";

/**
 * GET /api/cajas/[id]/lista-ventas — la lista de ventas del turno, para
 * imprimir y firmar (pedido del cliente).
 *
 * Solo lo que pidieron: código, factura, fecha, hora, cliente, tipo de venta,
 * estado, descuento y monto; abajo el total de descuentos y el total vendido,
 * y un espacio para las firmas. Se ofrece con la caja en cierre o cerrada:
 * con la caja abierta la lista todavía cambia.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function partesPy(iso: string | null | undefined): { fecha: string; hora: string } {
  if (!iso) return { fecha: "", hora: "" };
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return { fecha: "", hora: "" };
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`,
    hora: `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`,
  };
}

const ESTADO: Record<string, string> = {
  completada: "Completada",
  anulada: "Anulada",
  pendiente: "Pendiente",
  devuelta_total: "Devuelta",
  parcialmente_devuelta: "Dev. parcial",
};

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id: cajaId } = await context.params;

    const detalle = await getDetalleCaja(ctx.supabase, empresaId, cajaId, sucursalId);
    if (!detalle) return new NextResponse("Turno de caja no encontrado.", { status: 404 });
    const c = detalle.caja;
    const ventas = detalle.ventas;
    const ids = ventas.map((v) => v.id);

    // Número de factura y descuento de cada venta, en tandas de 100 ids.
    const facturaDe = new Map<string, string>();
    const descuentoDe = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 100) {
      const tanda = ids.slice(i, i + 100);
      const [vq, iq] = await Promise.all([
        ctx.supabase.from("ventas").select("id, factura_id").eq("empresa_id", empresaId).in("id", tanda),
        ctx.supabase.from("ventas_items").select("venta_id, cantidad, precio_venta_original, precio_venta")
          .eq("empresa_id", empresaId).in("venta_id", tanda),
      ]);
      const facIds = ((vq.data ?? []) as Array<{ id: string; factura_id: string | null }>).filter((v) => v.factura_id);
      if (facIds.length > 0) {
        const fq = await ctx.supabase.from("facturas").select("id, numero_factura")
          .eq("empresa_id", empresaId).in("id", facIds.map((v) => v.factura_id as string));
        const num = new Map(((fq.data ?? []) as Array<{ id: string; numero_factura: string | null }>).map((f) => [f.id, f.numero_factura ?? ""]));
        for (const v of facIds) {
          const n = num.get(v.factura_id as string);
          if (n) facturaDe.set(v.id, n);
        }
      }
      for (const l of (iq.data ?? []) as Array<{ venta_id: string; cantidad: number | string; precio_venta_original: number | string | null; precio_venta: number | string }>) {
        const orig = Number(l.precio_venta_original) || 0;
        const pv = Number(l.precio_venta) || 0;
        if (orig > pv) descuentoDe.set(l.venta_id, (descuentoDe.get(l.venta_id) ?? 0) + (orig - pv) * (Number(l.cantidad) || 0));
      }
    }

    const ordenadas = [...ventas].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    let totalDesc = 0;
    let totalMonto = 0;
    const filas = ordenadas.map((v) => {
      const anulada = v.estado === "anulada";
      const desc = Math.round(descuentoDe.get(v.id) ?? 0);
      if (!anulada) { totalDesc += desc; totalMonto += v.total; }
      const { fecha, hora } = partesPy(v.fecha);
      return `<tr${anulada ? ' class="anulada"' : ""}>
        <td class="mono">${esc(v.numero_control ?? "")}</td>
        <td class="mono">${esc(facturaDe.get(v.id) ?? "—")}</td>
        <td>${esc(fecha)}</td>
        <td>${esc(hora)}</td>
        <td>${esc(v.cliente_nombre || "Consumidor final")}</td>
        <td>${esc(v.tipo_venta === "CREDITO" ? "Crédito" : "Contado")}</td>
        <td>${esc(ESTADO[String(v.estado ?? "completada")] ?? v.estado ?? "")}</td>
        <td class="m">${desc > 0 ? gs(desc) : "—"}</td>
        <td class="m b">${gs(v.total)}</td>
      </tr>`;
    }).join("");

    const ap = partesPy(c.fecha_apertura);
    const ci = partesPy(c.fecha_cierre);
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Lista de ventas · Caja ${esc(String(c.numero_caja))} — ${esc(EMPRESA_DOC.nombre)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 8px 0 2px; }
  .sub { color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; border-bottom: 1.5px solid #111; padding: 4px; }
  td { border-bottom: 1px solid #ddd; padding: 4px; vertical-align: top; }
  .m { text-align: right; white-space: nowrap; }
  .b { font-weight: bold; }
  .mono { font-family: "Courier New", monospace; white-space: nowrap; }
  tr.anulada td { color: #999; text-decoration: line-through; }
  tfoot td { border-top: 1.5px solid #111; border-bottom: none; font-weight: bold; font-size: 12px; }
  .firmas { display: flex; gap: 40px; margin-top: 60px; }
  .firma { flex: 1; text-align: center; border-top: 1px solid #111; padding-top: 4px; }
  .nota { color: #777; font-size: 10px; margin-top: 6px; }
  .print { margin: 10px 0; }
  @media print { .print { display: none; } }
</style></head>
<body>
  ${membreteLinea()}
  <div class="print"><button onclick="window.print()">Imprimir</button></div>
  <h1>Lista de ventas · Caja ${esc(String(c.numero_caja))}</h1>
  <div class="sub">
    Abierta el ${esc(ap.fecha)} ${esc(ap.hora)}${c.abierta_por_nombre ? ` por ${esc(c.abierta_por_nombre)}` : ""}
    ${c.fecha_cierre ? ` · Cerrada el ${esc(ci.fecha)} ${esc(ci.hora)}${c.cerrada_por_nombre ? ` por ${esc(c.cerrada_por_nombre)}` : ""}` : " · En cierre"}
    · ${ordenadas.length} ${ordenadas.length === 1 ? "venta" : "ventas"}
  </div>
  <table>
    <thead><tr>
      <th>Código</th><th>Factura</th><th>Fecha</th><th>Hora</th><th>Cliente</th>
      <th>Tipo</th><th>Estado</th><th class="m">Descuento</th><th class="m">Monto</th>
    </tr></thead>
    <tbody>${filas || `<tr><td colspan="9" style="text-align:center;color:#777;padding:16px">No hubo ventas en este turno.</td></tr>`}</tbody>
    <tfoot><tr>
      <td colspan="7">Totales</td>
      <td class="m">${gs(totalDesc)}</td>
      <td class="m">${gs(totalMonto)}</td>
    </tr></tfoot>
  </table>
  <p class="nota">Las ventas anuladas se listan tachadas y no suman en los totales.</p>
  <div class="firmas">
    <div class="firma">Cajero/a</div>
    <div class="firma">Recibido por</div>
    <div class="firma">Administración</div>
  </div>
</body></html>`;

    return new NextResponse(await htmlConSucursal(ctx.supabase, sucursalId, html), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo armar la lista.";
    console.error("[/api/cajas/[id]/lista-ventas]", msg);
    return new NextResponse(msg, { status: 500 });
  }
}
