import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getAutoimpresor } from "@/lib/facturacion/server/facturacion-modo-pg";
import { AutoimpresorError, emitirFacturaAutoimpresor } from "@/lib/facturacion/server/autoimpresor-emitir";
import { numeroALetras } from "@/lib/documentos/numero-a-letras";

export const dynamic = "force-dynamic";

/**
 * POST /api/ventas/[id]/factura-autoimpresor — emite la factura (número del
 *      timbrado autoimpresor). Si ya tiene, devuelve la misma.
 * GET  /api/ventas/[id]/factura-autoimpresor — la hoja para imprimir:
 *      ORIGINAL (cliente) y DUPLICADO (archivo tributario), con los datos que
 *      pide la SET: emisor, RUC, timbrado y vigencia, número, condición de
 *      venta, cliente, IVA discriminado y total en letras. ?auto=1 imprime solo.
 */

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const r = await emitirFacturaAutoimpresor({
      schemaRaw: schema,
      empresaId: ctx.auth.empresa_id,
      sucursalId: ctx.auth.sucursal_id ?? null,
      ventaId: id,
    });
    return NextResponse.json(successResponse(r));
  } catch (err) {
    if (err instanceof AutoimpresorError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/ventas/[id]/factura-autoimpresor POST]", msg);
    if (/empresa_autoimpresor_config/.test(msg) && /does not exist/i.test(msg)) {
      return NextResponse.json(errorResponse("El autoimpresor no está configurado en esta base."), { status: 503 });
    }
    return NextResponse.json(errorResponse("No se pudo emitir la factura."), { status: 500 });
  }
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const gs = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");
function fecha(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const sb = ctx.supabase;

  const vq = await sb.from("ventas").select("id, numero_control, fecha, tipo_venta, plazo_dias, factura_id").eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  const v = vq.data as { numero_control?: string; fecha?: string; tipo_venta?: string; plazo_dias?: number | null; factura_id?: string | null } | null;
  if (!v) return new NextResponse("Venta no encontrada", { status: 404 });
  if (!v.factura_id) return new NextResponse("Esta venta no tiene factura emitida.", { status: 404 });

  const fq = await sb.from("facturas").select("numero_factura, fecha, tipo, cliente_razon_social, cliente_ruc, monto").eq("empresa_id", empresaId).eq("id", v.factura_id).maybeSingle();
  const f = fq.data as { numero_factura: string; fecha: string; tipo: string; cliente_razon_social: string | null; cliente_ruc: string | null; monto: number } | null;
  if (!f) return new NextResponse("Factura no encontrada", { status: 404 });
  const iq = await sb.from("factura_items").select("descripcion, cantidad, precio_unitario, tipo_iva, total").eq("empresa_id", empresaId).eq("factura_id", v.factura_id);
  const items = (iq.data ?? []) as Array<{ descripcion: string; cantidad: number; precio_unitario: number; tipo_iva: string; total: number }>;

  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const cfg = await getAutoimpresor(schema, empresaId);

  // Columnas de la SET: exentas, 5% y 10%, con el IVA incluido en el precio.
  let ex = 0, g5 = 0, g10 = 0;
  for (const it of items) {
    const t = Number(it.total) || 0;
    const tasa = String(it.tipo_iva ?? "10%").toUpperCase();
    if (tasa.startsWith("EX")) ex += t; else if (tasa.startsWith("5")) g5 += t; else g10 += t;
  }
  const iva5 = Math.round(g5 / 21), iva10 = Math.round(g10 / 11);
  const total = ex + g5 + g10;
  const credito = String(f.tipo ?? "").toLowerCase() === "credito";

  const hoja = (copia: string) => `
  <section class="fac">
    <div class="cab">
      <div class="emisor">
        <p class="razon">${esc(cfg.razon_social_emisor || cfg.nombre_fantasia || "")}</p>
        ${cfg.nombre_fantasia && cfg.razon_social_emisor ? `<p>${esc(cfg.nombre_fantasia)}</p>` : ""}
        <p>${esc(cfg.direccion_matriz || "")}</p>
        ${cfg.telefono ? `<p>Tel.: ${esc(cfg.telefono)}</p>` : ""}
      </div>
      <div class="timbrado">
        <p>TIMBRADO N° <b>${esc(cfg.timbrado_numero)}</b></p>
        <p>Inicio de vigencia: ${fecha(cfg.timbrado_inicio_vigencia)}</p>
        <p>Fin de vigencia: ${fecha(cfg.timbrado_fin_vigencia)}</p>
        <p>RUC: <b>${esc(cfg.ruc_emisor)}</b></p>
        <p class="tipo">FACTURA</p>
        <p class="nro">N° ${esc(f.numero_factura)}</p>
      </div>
    </div>

    <div class="cli">
      <p><span>Fecha de emisión:</span> ${fecha(f.fecha)}</p>
      <p><span>Condición de venta:</span> ${credito ? `☐ Contado ☒ Crédito${v.plazo_dias ? ` (${v.plazo_dias} días)` : ""}` : "☒ Contado ☐ Crédito"}</p>
      <p><span>Nombre o razón social:</span> ${esc(f.cliente_razon_social)}</p>
      <p><span>RUC / C.I.:</span> ${esc(f.cliente_ruc)}</p>
    </div>

    <table>
      <thead>
        <tr><th class="c">Cant.</th><th>Descripción</th><th class="n">Precio unit.</th><th class="n">Exentas</th><th class="n">5%</th><th class="n">10%</th></tr>
      </thead>
      <tbody>
        ${items.map((it) => {
          const tasa = String(it.tipo_iva ?? "10%").toUpperCase();
          const t = Number(it.total) || 0;
          return `<tr><td class="c">${(Number(it.cantidad) || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 })}</td>
            <td>${esc(it.descripcion)}</td><td class="n">${gs(it.precio_unitario)}</td>
            <td class="n">${tasa.startsWith("EX") ? gs(t) : ""}</td><td class="n">${tasa.startsWith("5") ? gs(t) : ""}</td>
            <td class="n">${!tasa.startsWith("EX") && !tasa.startsWith("5") ? gs(t) : ""}</td></tr>`;
        }).join("")}
      </tbody>
      <tfoot>
        <tr><td colspan="3">Subtotales</td><td class="n">${gs(ex)}</td><td class="n">${gs(g5)}</td><td class="n">${gs(g10)}</td></tr>
        <tr class="tot"><td colspan="5">TOTAL A PAGAR: Gs. ${esc(numeroALetras(total))}</td><td class="n">${gs(total)}</td></tr>
        <tr><td colspan="6">Liquidación del IVA: (5%) ${gs(iva5)} · (10%) ${gs(iva10)} · Total IVA: ${gs(iva5 + iva10)}</td></tr>
      </tfoot>
    </table>
    <p class="copia">${copia}</p>
  </section>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${esc(f.numero_factura)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5px; margin: 0; }
  .fac { border: 1px solid #111; padding: 8px 10px; margin-bottom: 8mm; page-break-inside: avoid; }
  .cab { display: grid; grid-template-columns: 1fr 230px; gap: 10px; border-bottom: 1px solid #111; padding-bottom: 6px; }
  .emisor p, .timbrado p, .cli p { margin: 1px 0; }
  .razon { font-size: 14px; font-weight: 700; }
  .timbrado { border-left: 1px solid #111; padding-left: 10px; }
  .tipo { font-size: 14px; font-weight: 700; margin-top: 4px !important; }
  .nro { font-size: 13px; font-weight: 700; }
  .cli { padding: 6px 0; border-bottom: 1px solid #111; display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .cli span { color: #444; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { font-size: 9.5px; text-align: left; border-bottom: 1px solid #111; padding: 3px; }
  td { padding: 2px 3px; border-bottom: 1px solid #eee; }
  .n { text-align: right; font-variant-numeric: tabular-nums; } .c { text-align: center; width: 48px; }
  tfoot td { border-top: 1px solid #111; border-bottom: none; font-weight: 600; }
  tfoot .tot td { font-size: 11.5px; font-weight: 700; }
  .copia { text-align: right; font-size: 9px; color: #444; margin: 4px 0 0; }
  @media print { .noprint { display: none; } }
</style></head><body>
${hoja("ORIGINAL: CLIENTE")}
${hoja("DUPLICADO: ARCHIVO TRIBUTARIO")}
${new URL(request.url).searchParams.get("auto") === "1" ? "<script>window.onload=()=>window.print()</script>" : ""}
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
