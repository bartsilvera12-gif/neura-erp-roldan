import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4, EMPRESA_DOC } from "@/lib/documentos/membrete";
import { hojaSobria } from "@/lib/documentos/hoja-sobria";
import { tipoNovedad } from "@/lib/rrhh/novedades";

export const dynamic = "force-dynamic";

/**
 * GET /api/rrhh/novedades/[id]/hoja — la notificación que firma el empleado:
 * amonestación, suspensión o reconocimiento. Dos copias por hoja, una para la
 * empresa y otra para él. La firma es "en señal de haber tomado conocimiento",
 * no de conformidad: así puede firmarla aunque no esté de acuerdo.
 */

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fecha(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function masDias(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const { id } = await params;
  const empresaId = ctx.auth.empresa_id;

  const nq = await ctx.supabase
    .from("empleado_novedades")
    .select("id, empleado_id, tipo, fecha, motivo, detalle, dias_suspension, suspension_desde, estado")
    .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (nq.error || !nq.data) return new NextResponse("Registro no encontrado", { status: 404 });
  const n = nq.data as {
    empleado_id: string; tipo: string; fecha: string; motivo: string; detalle: string | null;
    dias_suspension: number | null; suspension_desde: string | null; estado: string;
  };
  if (n.estado === "anulada") return new NextResponse("Este registro está anulado: no hay nada que firmar.", { status: 409 });
  const t = tipoNovedad(n.tipo);
  if (!t.seFirma) return new NextResponse(`Una ${t.label.toLowerCase()} no se imprime para firmar.`, { status: 400 });

  const eq = await ctx.supabase.from("empleados").select("nombre, documento, cargo, legajo")
    .eq("empresa_id", empresaId).eq("id", n.empleado_id).maybeSingle();
  const e = (eq.data ?? {}) as { nombre?: string; documento?: string | null; cargo?: string | null; legajo?: string | null };
  const empresa = esc(EMPRESA_DOC.nombre);

  const titulo = n.tipo === "amonestacion" ? "Amonestación"
    : n.tipo === "suspension" ? "Notificación de suspensión"
    : "Reconocimiento";

  let texto: string;
  if (n.tipo === "suspension") {
    const dias = Number(n.dias_suspension || 0);
    const desde = n.suspension_desde ? String(n.suspension_desde).slice(0, 10) : null;
    const rango = desde
      ? `, desde el <strong>${fecha(desde)}</strong> hasta el <strong>${fecha(masDias(desde, dias - 1))}</strong> inclusive`
      : "";
    texto = `Por la presente se notifica a <strong>${esc(e.nombre)}</strong>, C.I. ${esc(e.documento) || "—"}, que se le aplica
      una <strong>suspensión de ${dias} ${dias === 1 ? "día" : "días"} sin goce de sueldo</strong>${rango}, por el motivo
      que se detalla. El trabajador firma en señal de haber sido notificado.`;
  } else if (n.tipo === "amonestacion") {
    texto = `Por la presente se <strong>amonesta</strong> a <strong>${esc(e.nombre)}</strong>, C.I. ${esc(e.documento) || "—"},
      por el motivo que se detalla, y se lo exhorta a no reiterar esta conducta. El trabajador firma en señal de
      haber sido notificado.`;
  } else {
    texto = `La empresa deja constancia de su <strong>reconocimiento</strong> a <strong>${esc(e.nombre)}</strong>,
      C.I. ${esc(e.documento) || "—"}, por lo que se detalla a continuación.`;
  }

  const copia = (tag: string) => `
  <section class="copia">
    ${membreteA4("", { linea: "1px solid #D4D4D8", compacto: true })}
    <div class="titulo">
      <div>
        <h1>${titulo}</h1>
        <p class="periodo">Fecha: ${fecha(n.fecha)}</p>
      </div>
      <span class="copia-tag">${tag}</span>
    </div>

    <div class="datos">
      <div><span class="lbl">Trabajador</span><span class="val fuerte">${esc(e.nombre)}</span></div>
      <div><span class="lbl">C.I.</span><span class="val">${esc(e.documento) || "—"}</span></div>
      <div><span class="lbl">Cargo</span><span class="val">${esc(e.cargo) || "—"}</span></div>
    </div>

    <div class="motivo">
      <span class="lbl">Motivo</span>
      <p class="fuerte">${esc(n.motivo)}</p>
      ${n.detalle ? `<p class="detalle">${esc(n.detalle).replace(/\n/g, "<br>")}</p>` : ""}
    </div>

    <p class="texto">${texto}</p>

    <p class="lugar">Lugar y fecha: ____________________________________</p>

    <div class="firmas">
      <div class="firma">Por ${empresa}</div>
      <div class="firma">Firma del trabajador<span>Aclaración y C.I.</span></div>
    </div>
  </section>`;

  const html = hojaSobria({
    titulo: `${titulo} · ${esc(e.nombre)} · ${fecha(n.fecha)}`,
    cuerpo: `${copia("Copia empresa")}${copia("Copia trabajador")}`,
    css: `
  .motivo { padding: 10px 12px; border: 1px solid #E4E4E7; border-radius: 4px; }
  .motivo p { margin: 2px 0 0; }
  .motivo .fuerte { font-size: 12px; font-weight: 600; color: #18181B; }
  .motivo .detalle { margin-top: 6px; font-size: 10.5px; line-height: 1.55; color: #3F3F46; }
  .texto { margin: 12px 0 0; font-size: 10.5px; line-height: 1.6; color: #27272A; }
  .lugar { margin: 14px 0 0; font-size: 10px; color: #3F3F46; }
`,
  });

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
