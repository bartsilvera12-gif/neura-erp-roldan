import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4, EMPRESA_DOC } from "@/lib/documentos/membrete";
import { hojaSobria } from "@/lib/documentos/hoja-sobria";
import { antiguedadTexto, diaDeReintegroPy, diasPorAntiguedad, saldoVacacionesPy } from "@/lib/rrhh/vacaciones-py";

export const dynamic = "force-dynamic";

/**
 * GET /api/rrhh/vacaciones/[id]/constancia — comunicación de vacaciones.
 *
 * La hoja que el trabajador firma antes de salir: cuántos días le
 * corresponden, desde cuándo hasta cuándo, qué día vuelve y cuánto le queda.
 * Dos copias por hoja, una para la empresa y otra para él.
 */

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fecha(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function fechaLarga(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${fecha(iso)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const { id } = await params;
  const empresaId = ctx.auth.empresa_id;

  const vq = await ctx.supabase
    .from("empleado_vacaciones")
    .select("id, empleado_id, fecha_desde, fecha_hasta, dias, tipo_ausencia, estado, observacion, origen")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (vq.error || !vq.data) return new NextResponse("Registro no encontrado", { status: 404 });
  const v = vq.data as {
    empleado_id: string; fecha_desde: string; fecha_hasta: string; dias: number;
    tipo_ausencia: string | null; estado: string; observacion: string | null;
  };
  if ((v.tipo_ausencia ?? "vacaciones") !== "vacaciones") {
    return new NextResponse("La comunicación es solo para vacaciones.", { status: 400 });
  }
  if (v.estado === "cancelada" || v.estado === "rechazada") {
    return new NextResponse(`Estas vacaciones están ${v.estado}s: no hay nada que firmar.`, { status: 409 });
  }

  const desde = String(v.fecha_desde).slice(0, 10);
  const hasta = String(v.fecha_hasta).slice(0, 10);

  const [eq, usosQ, ferQ] = await Promise.all([
    ctx.supabase.from("empleados").select("nombre, documento, cargo, fecha_ingreso").eq("empresa_id", empresaId).eq("id", v.empleado_id).maybeSingle(),
    ctx.supabase.from("empleado_vacaciones").select("id, fecha_desde, dias, tipo_ausencia")
      .eq("empresa_id", empresaId).eq("empleado_id", v.empleado_id).eq("estado", "aprobada"),
    ctx.supabase.from("feriados").select("fecha").eq("empresa_id", empresaId)
      .gte("fecha", hasta).lte("fecha", `${Number(hasta.slice(0, 4)) + 1}-12-31`),
  ]);
  const e = (eq.data ?? {}) as { nombre?: string; documento?: string | null; cargo?: string | null; fecha_ingreso?: string | null };
  const feriados = ferQ.error ? [] : ((ferQ.data ?? []) as Array<{ fecha: string }>).map((f) => String(f.fecha).slice(0, 10));
  const reintegro = diaDeReintegroPy(hasta, feriados);

  // Saldo a la fecha de salida: con y sin estas vacaciones.
  const ingreso = e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : null;
  const usos = ((usosQ.data ?? []) as Array<{ id: string; fecha_desde: string; dias: number; tipo_ausencia: string | null }>)
    .filter((u) => (u.tipo_ausencia ?? "vacaciones") === "vacaciones" && u.id !== id)
    .map((u) => ({ fecha_desde: String(u.fecha_desde).slice(0, 10), dias: Number(u.dias) || 0 }));
  const antes = saldoVacacionesPy(ingreso, desde, usos);
  const despues = antes.dias_disponibles - Number(v.dias || 0);
  const antig = ingreso ? `${antiguedadTexto(ingreso, desde) ?? "—"} (ingresó el ${fecha(ingreso)})` : "Sin fecha de ingreso";
  const empresa = esc(EMPRESA_DOC.nombre);
  const n = Number(v.dias || 0);

  const copia = (titulo: string) => `
  <section class="copia">
    ${membreteA4("", { linea: "1px solid #D4D4D8", compacto: true })}
    <div class="titulo">
      <div>
        <h1>Comunicación de vacaciones</h1>
        <p class="periodo">Vacaciones anuales remuneradas · Código del Trabajo, art. 218</p>
      </div>
      <span class="copia-tag">${titulo}</span>
    </div>

    <div class="datos">
      <div><span class="lbl">Trabajador</span><span class="val fuerte">${esc(e.nombre)}</span></div>
      <div><span class="lbl">C.I.</span><span class="val">${esc(e.documento) || "—"}</span></div>
      <div><span class="lbl">Cargo</span><span class="val">${esc(e.cargo) || "—"}</span></div>
      <div style="grid-column: span 2"><span class="lbl">Antigüedad</span><span class="val">${esc(antig)}</span></div>
      <div><span class="lbl">Le corresponden por año</span><span class="val">${diasPorAntiguedad(Math.max(1, antes.anios))} días hábiles</span></div>
    </div>

    <div class="fechas">
      <div><span class="lbl">Sale de vacaciones</span><span class="grande">${fechaLarga(desde)}</span></div>
      <div><span class="lbl">Último día de vacaciones</span><span class="grande">${fechaLarga(hasta)}</span></div>
      <div class="destacado"><span class="lbl">Se reintegra</span><span class="grande">${fechaLarga(reintegro)}</span></div>
    </div>

    <table class="saldo">
      <tr><td>Días hábiles disponibles al salir</td><td class="num">${antes.dias_disponibles}</td></tr>
      <tr><td>Días hábiles que toma (lunes a sábado, sin feriados)</td><td class="num">− ${n}</td></tr>
      <tr class="total"><td>Le quedan</td><td class="num">${despues}</td></tr>
    </table>
    ${despues < 0 ? `<p class="aviso">Toma ${Math.abs(despues)} día${Math.abs(despues) === 1 ? "" : "s"} más de los que tenía disponibles (adelanto de vacaciones).</p>` : ""}

    ${v.observacion ? `<p class="obs"><span class="lbl">Observaciones</span> ${esc(v.observacion)}</p>` : ""}

    <p class="texto">
      Por la presente se comunica a <strong>${esc(e.nombre)}</strong>, C.I. ${esc(e.documento) || "—"}, que gozará de sus
      vacaciones anuales remuneradas por <strong>${n} ${n === 1 ? "día hábil" : "días hábiles"}</strong>, desde el
      <strong>${fecha(desde)}</strong> hasta el <strong>${fecha(hasta)}</strong> inclusive, debiendo reintegrarse a sus funciones
      el <strong>${fecha(reintegro)}</strong>. El trabajador firma en señal de haber tomado conocimiento y de conformidad.
    </p>

    <p class="lugar">Lugar y fecha: ____________________________________</p>

    <div class="firmas">
      <div class="firma">Por ${empresa}</div>
      <div class="firma">Firma del trabajador<span>Aclaración y C.I.</span></div>
    </div>
  </section>`;

  const html = hojaSobria({
    titulo: `Comunicación de vacaciones · ${esc(e.nombre)} · ${fecha(desde)}`,
    cuerpo: `${copia("Copia empresa")}${copia("Copia trabajador")}`,
    css: `
  .fechas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .fechas div { display: flex; flex-direction: column; padding: 8px 10px; border: 1px solid #E4E4E7; border-radius: 4px; }
  .fechas .destacado { background: #18181B; border-color: #18181B; }
  .fechas .destacado .lbl { color: #A1A1AA; }
  .fechas .destacado .grande { color: #fff; }
  .grande { font-size: 12.5px; font-weight: 600; color: #18181B; }
  table.saldo { width: 100%; border-collapse: collapse; }
  table.saldo td { padding: 4px 0; border-bottom: 1px solid #F4F4F5; }
  table.saldo tr.total td { font-weight: 700; border-top: 1px solid #18181B; border-bottom: none; padding-top: 6px; }
  .aviso { margin: 6px 0 0; font-size: 9.5px; color: #B45309; }
  .texto { margin: 12px 0 0; font-size: 10.5px; line-height: 1.6; color: #27272A; }
  .lugar { margin: 14px 0 0; font-size: 10px; color: #3F3F46; }
`,
  });

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
