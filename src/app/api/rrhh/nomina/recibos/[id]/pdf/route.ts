import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function gs(v: unknown): string {
  return `Gs. ${Math.round(n(v)).toLocaleString("es-PY")}`;
}
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function fecha(v: unknown): string {
  const s = String(v ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** GET /api/rrhh/nomina/recibos/[id]/pdf — recibo de salario imprimible (HTML A4). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const { id } = await params;
  if (!id) return new NextResponse("id obligatorio", { status: 400 });

  const [recQ, devQ, dedQ] = await Promise.all([
    ctx.supabase.from("nomina_recibos").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle(),
    ctx.supabase.from("nomina_recibo_devengos").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("recibo_id", id).order("orden", { ascending: true }),
    ctx.supabase.from("nomina_recibo_deducciones").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("recibo_id", id).order("tipo", { ascending: true }).order("orden", { ascending: true }),
  ]);

  if (recQ.error || !recQ.data) return new NextResponse("Recibo no encontrado", { status: 404 });
  const r = recQ.data as Row;
  const devengos = (devQ.data ?? []) as Row[];
  const deducciones = (dedQ.data ?? []) as Row[];

  const totalDevengado = devengos.reduce((a, d) => a + n(d.importe_total), 0);
  const dedTrab = deducciones.filter((d) => d.tipo !== "ips_patronal");
  const aportEmp = deducciones.filter((d) => d.tipo === "ips_patronal");
  const totalDeducTrab = dedTrab.reduce((a, d) => a + n(d.importe), 0);
  const totalAportEmp = aportEmp.reduce((a, d) => a + n(d.importe), 0);
  const liquido = totalDevengado - totalDeducTrab;
  const costeEmpresa = totalDevengado + totalAportEmp;

  const filaDev = (d: Row) => `
    <tr>
      <td>${esc(d.concepto)}</td>
      <td style="text-align:right;">${d.cantidad != null ? esc(d.cantidad) : ""}</td>
      <td style="text-align:right;">${d.importe_unitario != null ? gs(d.importe_unitario) : ""}</td>
      <td style="text-align:right;">${gs(d.importe_total)}</td>
    </tr>`;
  const filaDed = (d: Row) => `
    <tr>
      <td>${esc(d.concepto)}</td>
      <td style="text-align:right;">${d.tipo_pct != null ? `${esc(d.tipo_pct)}%` : ""}</td>
      <td style="text-align:right;">${gs(d.importe)}</td>
    </tr>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Recibo de salario ${esc(r.empleado_nombre_snapshot)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; padding: 24px; }
  .wrap { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 8px 0 2px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12px; margin-bottom: 18px; }
  .grid div span { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
  th { text-align: left; background: #f3f4f6; padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  h2 { font-size: 13px; margin: 16px 0 6px; }
  .tot { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 8px; }
  .tot.big { font-weight: 800; font-size: 15px; background: #ecfdf5; border-radius: 6px; margin-top: 4px; }
  .foot { margin-top: 40px; display: flex; justify-content: space-around; font-size: 12px; }
  .firma { border-top: 1px solid #9ca3af; padding-top: 4px; width: 220px; text-align: center; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body><div class="wrap">
  ${membreteA4()}

  <h1>Recibo de salario</h1>
  <div class="sub">Período ${fecha(r.periodo_desde)} — ${fecha(r.periodo_hasta)} · ${esc(r.total_dias)} días</div>

  <div class="grid">
    <div><span>Empleado:</span> <strong>${esc(r.empleado_nombre_snapshot)}</strong></div>
    <div><span>Documento:</span> ${esc(r.empleado_documento_snapshot) || "—"}</div>
    <div><span>Cargo:</span> ${esc(r.empleado_cargo_snapshot) || "—"}</div>
    <div><span>Antigüedad:</span> ${esc(r.empleado_antiguedad_snapshot) || "—"}</div>
    <div><span>Afiliación IPS:</span> ${esc(r.empleado_afiliacion_ips_snapshot) || "—"}</div>
    <div><span>Categoría IPS:</span> ${esc(r.empleado_categoria_ips_snapshot) || "—"}</div>
  </div>

  <h2>Devengos</h2>
  <table>
    <thead><tr><th>Concepto</th><th style="text-align:right;">Cant.</th><th style="text-align:right;">Unitario</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>${devengos.map(filaDev).join("") || `<tr><td colspan="4" style="color:#9ca3af;">Sin devengos</td></tr>`}</tbody>
  </table>
  <div class="tot"><span>Total devengado</span><strong>${gs(totalDevengado)}</strong></div>

  <h2>Deducciones (trabajador)</h2>
  <table>
    <thead><tr><th>Concepto</th><th style="text-align:right;">%</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>${dedTrab.map(filaDed).join("") || `<tr><td colspan="3" style="color:#9ca3af;">Sin deducciones</td></tr>`}</tbody>
  </table>
  <div class="tot"><span>Total deducciones</span><strong>${gs(totalDeducTrab)}</strong></div>

  <div class="tot big"><span>Líquido a percibir</span><span>${gs(liquido)}</span></div>

  <h2>Aporte patronal (IPS 16,5%)</h2>
  <table>
    <thead><tr><th>Concepto</th><th style="text-align:right;">%</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>${aportEmp.map(filaDed).join("") || `<tr><td colspan="3" style="color:#9ca3af;">Sin aportes</td></tr>`}</tbody>
  </table>
  <div class="tot"><span>Costo total empresa</span><strong>${gs(costeEmpresa)}</strong></div>

  ${r.observaciones ? `<h2>Observaciones</h2><div style="font-size:12px;color:#374151;">${esc(r.observaciones)}</div>` : ""}

  <div class="foot">
    <div class="firma">Firma empleador</div>
    <div class="firma">Firma empleado</div>
  </div>

  <div class="noprint" style="margin-top:24px;text-align:center;">
    <button onclick="window.print()" style="background:#0EA5E9;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
</div>
<script>window.addEventListener("load", () => { try { window.print(); } catch (e) {} });</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
