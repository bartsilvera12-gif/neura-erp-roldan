import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";
import { antiguedadTexto } from "@/lib/rrhh/vacaciones-py";
import { nombreMes } from "@/lib/rrhh/nomina-py";
import { numeroALetras } from "@/lib/documentos/numero-a-letras";
import { hojaSobria } from "@/lib/documentos/hoja-sobria";

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

  // "noviembre 2026" → "Noviembre de 2026". Antes un text-transform:capitalize
  // en el subtítulo ponía en mayúscula cada palabra: "30 Días Trabajados".
  const mesTitulo = mes.replace(/^(\p{L})(\S*) (\d{4})$/u, (_m, a: string, b: string, y: string) => `${a.toUpperCase()}${b} de ${y}`);
  const diasTrab = Number(r.dias_trabajados ?? 30);
  const pct = (v: unknown) => (v != null ? ` (${String(v).replace(".", ",")}%)` : "");

  const filaIng = (d: Row) => `
      <tr>
        <td>${esc(d.concepto)}${d.cantidad != null && d.importe_unitario != null ? `<span class="det">${esc(d.cantidad)} × ${gs(d.importe_unitario)}</span>` : ""}${d.es_salarial === false ? '<span class="det">No aporta IPS</span>' : ""}</td>
        <td class="num">${gs(d.importe_total)}</td>
      </tr>`;
  const filaDes = (d: Row) => `
      <tr>
        <td>${esc(d.concepto)}${d.tipo === "ips_trabajador" ? pct(d.tipo_pct) : ""}</td>
        <td class="num">${gs(d.importe)}</td>
      </tr>`;

  // Dos copias en la hoja: una para la empresa y otra para el trabajador. Cada
  // una con su membrete: se cortan por la línea punteada y van por separado.
  const copia = (titulo: string) => `
  <section class="copia">
    ${membreteA4("", { linea: "1px solid #D4D4D8", compacto: true })}
    <div class="titulo">
      <div>
        <h1>Recibo de salario</h1>
        <p class="periodo">${esc(mesTitulo)} · ${diasTrab} ${diasTrab === 1 ? "día trabajado" : "días trabajados"}</p>
      </div>
      <span class="copia-tag">${titulo}</span>
    </div>

    <div class="datos">
      <div><span class="lbl">Trabajador</span><span class="val fuerte">${esc(r.empleado_nombre_snapshot)}</span></div>
      <div><span class="lbl">C.I.</span><span class="val">${esc(r.empleado_documento_snapshot) || "—"}</span></div>
      <div><span class="lbl">Cargo</span><span class="val">${esc(r.empleado_cargo_snapshot) || "—"}</span></div>
      <div><span class="lbl">N.º asegurado IPS</span><span class="val">${esc(r.empleado_afiliacion_ips_snapshot) || "—"}</span></div>
      <div><span class="lbl">Antigüedad</span><span class="val">${esc(antig)}</span></div>
      <div><span class="lbl">Período</span><span class="val">${fecha(r.periodo_desde)} al ${fecha(r.periodo_hasta)}</span></div>
    </div>

    <div class="cuentas">
      <table>
        <thead><tr><th>Ingresos</th><th class="num">Importe</th></tr></thead>
        <tbody>${devengos.map(filaIng).join("") || '<tr><td class="vacio" colspan="2">Sin ingresos</td></tr>'}</tbody>
        <tfoot><tr><td>Total ingresos</td><td class="num">${gs(totalIngresos)}</td></tr></tfoot>
      </table>
      <table>
        <thead><tr><th>Descuentos</th><th class="num">Importe</th></tr></thead>
        <tbody>${descuentos.map(filaDes).join("") || '<tr><td class="vacio" colspan="2">Sin descuentos</td></tr>'}</tbody>
        <tfoot><tr><td>Total descuentos</td><td class="num">${gs(totalDescuentos)}</td></tr></tfoot>
      </table>
    </div>

    <div class="neto">
      <span>Neto a cobrar</span>
      <span class="num">${gs(neto)}</span>
    </div>
    <p class="letras">Son guaraníes: ${esc(numeroALetras(neto).toLowerCase())}.</p>

    ${r.observaciones ? `<p class="obs"><span class="lbl">Observaciones</span> ${esc(r.observaciones)}</p>` : ""}

    <p class="recibi">Recibí de <strong>${empresa}</strong> la suma de <strong>${gs(neto)}</strong> en concepto de salario correspondiente a ${esc(mes)}, de conformidad con el detalle que antecede.</p>

    <div class="firmas">
      <div class="firma">Firma del empleador</div>
      <div class="firma">Firma del trabajador<span>Aclaración y C.I.</span></div>
    </div>
  </section>`;

  const html = hojaSobria({
    titulo: `Recibo de salario ${esc(r.empleado_nombre_snapshot)} · ${esc(mesTitulo)}`,
    cuerpo: `${copia("Copia empresa")}${copia("Copia trabajador")}`,
    css: `
  .cuentas { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #71717A; text-align: left; padding: 0 0 5px; border-bottom: 1px solid #18181B; }
  td { padding: 4px 0; border-bottom: 1px solid #F4F4F5; vertical-align: top; }
  .det { display: block; font-size: 9px; color: #71717A; }
  .vacio { color: #A1A1AA; }
  tfoot td { font-weight: 600; border-bottom: none; border-top: 1px solid #D4D4D8; padding-top: 6px; }

  .neto { display: flex; justify-content: space-between; align-items: baseline; margin-top: 10px; padding: 8px 12px; background: #18181B; color: #fff; border-radius: 4px; }
  .neto span:first-child { font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
  .neto .num { font-size: 15px; font-weight: 700; }
  .letras { margin: 5px 0 0; font-size: 9.5px; color: #52525B; text-align: right; }
  .recibi { margin: 8px 0 0; font-size: 10px; color: #27272A; }
`,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
