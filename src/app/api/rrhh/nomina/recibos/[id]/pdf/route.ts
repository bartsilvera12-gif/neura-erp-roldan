import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";
import { antiguedadTexto } from "@/lib/rrhh/vacaciones-py";
import { nombreMes } from "@/lib/rrhh/nomina-py";

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

  // Recibo del TRABAJADOR, como se usa en Paraguay: lo que cobra, lo que se le
  // descuenta (IPS 9% y lo demás) y el neto, con "recibí conforme". El aporte
  // patronal es un costo de la empresa y no va en su recibo. Antes salían
  // "devengos", "líquido a percibir" y "costo total empresa", de una nómina
  // española, y la antigüedad como una fecha suelta.
  const totalIngresos = devengos.reduce((a, d) => a + Math.round(n(d.importe_total)), 0);
  const descuentos = deducciones.filter((d) => d.tipo !== "ips_patronal");
  const totalDescuentos = descuentos.reduce((a, d) => a + Math.round(n(d.importe)), 0);
  const neto = totalIngresos - totalDescuentos;
  const hoyPy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ingreso = String(r.empleado_antiguedad_snapshot ?? "").slice(0, 10);
  const antig = /^\d{4}-\d{2}-\d{2}$/.test(ingreso) ? `${antiguedadTexto(ingreso, hoyPy) ?? ""} (desde ${fecha(ingreso)})` : "—";
  const mes = nombreMes(String(r.periodo_desde ?? ""));
  const empresa = esc(r.empresa_nombre_snapshot) || "la empresa";

  const filaIng = (d: Row) => `
    <tr>
      <td>${esc(d.concepto)}${d.es_salarial === false ? ' <span class="muted">(no aporta IPS)</span>' : ""}</td>
      <td class="r muted">${d.cantidad != null && d.importe_unitario != null ? `${esc(d.cantidad)} × ${gs(d.importe_unitario)}` : ""}</td>
      <td class="r">${gs(d.importe_total)}</td>
    </tr>`;
  const filaDes = (d: Row) => `
    <tr>
      <td>${esc(d.concepto)}</td>
      <td class="r muted">${d.tipo_pct != null ? `${String(d.tipo_pct).replace(".", ",")}%` : ""}</td>
      <td class="r">${gs(d.importe)}</td>
    </tr>`;

  // Dos copias en la hoja: una para la empresa y otra para el trabajador.
  const copia = (titulo: string) => `
  <section class="copia">
    <div class="head">
      <div><h1>Recibo de salario</h1><div class="sub">${esc(mes)} · ${esc(r.dias_trabajados ?? 30)} días trabajados</div></div>
      <div class="tag">${titulo}</div>
    </div>
    <div class="grid">
      <div><span>Trabajador:</span> <strong>${esc(r.empleado_nombre_snapshot)}</strong></div>
      <div><span>C.I.:</span> ${esc(r.empleado_documento_snapshot) || "—"}</div>
      <div><span>Cargo:</span> ${esc(r.empleado_cargo_snapshot) || "—"}</div>
      <div><span>N.º asegurado IPS:</span> ${esc(r.empleado_afiliacion_ips_snapshot) || "—"}</div>
      <div><span>Antigüedad:</span> ${esc(antig)}</div>
      <div><span>Período:</span> ${fecha(r.periodo_desde)} al ${fecha(r.periodo_hasta)}</div>
    </div>
    <table>
      <thead><tr><th>Ingresos</th><th></th><th class="r">Importe</th></tr></thead>
      <tbody>${devengos.map(filaIng).join("") || '<tr><td colspan="3" class="muted">Sin ingresos</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Total ingresos</td><td class="r">${gs(totalIngresos)}</td></tr></tfoot>
    </table>
    <table>
      <thead><tr><th>Descuentos</th><th></th><th class="r">Importe</th></tr></thead>
      <tbody>${descuentos.map(filaDes).join("") || '<tr><td colspan="3" class="muted">Sin descuentos</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Total descuentos</td><td class="r">${gs(totalDescuentos)}</td></tr></tfoot>
    </table>
    <div class="neto"><span>Neto a cobrar</span><span>${gs(neto)}</span></div>
    ${r.observaciones ? `<div class="obs">${esc(r.observaciones)}</div>` : ""}
    <p class="recibi">Recibí de ${empresa} la suma de <strong>${gs(neto)}</strong> en concepto de salario correspondiente a ${esc(mes)}, de conformidad con el detalle que antecede.</p>
    <div class="foot">
      <div class="firma">Firma del empleador</div>
      <div class="firma">Firma del trabajador<br /><span class="muted">Aclaración y C.I.</span></div>
    </div>
  </section>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Recibo de salario ${esc(r.empleado_nombre_snapshot)} · ${esc(mes)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; padding: 20px; }
  .wrap { max-width: 800px; margin: 0 auto; }
  .copia { padding: 10px 0 18px; }
  .copia + .copia { border-top: 1px dashed #9ca3af; padding-top: 18px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 16px; margin: 4px 0 0; }
  .sub { font-size: 11px; color: #6b7280; margin-bottom: 10px; text-transform: capitalize; }
  .tag { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #3F8E91; border: 1px solid #4FAEB2; border-radius: 999px; padding: 2px 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; font-size: 11px; margin-bottom: 10px; }
  .grid span, .muted { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 6px; }
  th { text-align: left; background: #f3f4f6; padding: 5px 8px; font-weight: 600; }
  td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
  tfoot td { font-weight: 700; border-bottom: none; }
  .r { text-align: right; }
  .neto { display: flex; justify-content: space-between; font-weight: 800; font-size: 14px; background: #E5F4F4; border-radius: 6px; padding: 6px 8px; margin-top: 4px; }
  .obs { font-size: 11px; color: #374151; margin-top: 8px; }
  .recibi { font-size: 11px; margin: 12px 0 0; }
  .foot { margin-top: 34px; display: flex; justify-content: space-around; font-size: 11px; }
  .firma { border-top: 1px solid #9ca3af; padding-top: 4px; width: 220px; text-align: center; }
  @media print { body { padding: 0; } .noprint { display: none; } .copia { break-inside: avoid; } }
</style></head>
<body><div class="wrap">
  ${membreteA4()}
  ${copia("Copia empresa")}
  ${copia("Copia trabajador")}
  <div class="noprint" style="margin-top:20px;text-align:center;">
    <button onclick="window.print()" style="background:#4FAEB2;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
</div>
<script>window.addEventListener("load", () => { try { window.print(); } catch (e) {} });</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
