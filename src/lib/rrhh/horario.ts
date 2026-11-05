/**
 * Horario semanal del empleado (script 74).
 *
 * Una entrada por día que trabaja, con la clave del día de la semana
 * (0 = domingo … 6 = sábado). El día que no está, no trabaja. Antes había una
 * sola "hora de entrada" para todos los días, y el sábado corto —lo normal en
 * la casa— no se podía decir.
 *
 * Módulo puro: lo usan la ficha (para editar y mostrar) y el control horario
 * (para medir la tardanza contra la entrada de ESE día).
 */

export type Turno = { entrada: string | null; salida: string | null };
export type HorarioSemanal = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", Turno>>;

export const DIAS_SEMANA: Array<{ clave: keyof HorarioSemanal; corto: string; largo: string }> = [
  { clave: "1", corto: "Lun", largo: "Lunes" },
  { clave: "2", corto: "Mar", largo: "Martes" },
  { clave: "3", corto: "Mié", largo: "Miércoles" },
  { clave: "4", corto: "Jue", largo: "Jueves" },
  { clave: "5", corto: "Vie", largo: "Viernes" },
  { clave: "6", corto: "Sáb", largo: "Sábado" },
  { clave: "0", corto: "Dom", largo: "Domingo" },
];

/** Lunes a viernes 07:00–17:00 y sábado 07:00–11:00: lo más común en la casa. */
export const HORARIO_SUGERIDO: HorarioSemanal = {
  "1": { entrada: "07:00", salida: "17:00" },
  "2": { entrada: "07:00", salida: "17:00" },
  "3": { entrada: "07:00", salida: "17:00" },
  "4": { entrada: "07:00", salida: "17:00" },
  "5": { entrada: "07:00", salida: "17:00" },
  "6": { entrada: "07:00", salida: "11:00" },
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)/;

function hora(v: unknown): string | null {
  const m = HHMM.exec(String(v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Del jsonb de la base (o de lo que mande la pantalla) a un horario limpio. */
export function normalizarHorario(v: unknown): HorarioSemanal | null {
  let o = v;
  if (typeof o === "string") {
    try { o = JSON.parse(o); } catch { return null; }
  }
  if (!o || typeof o !== "object") return null;
  const out: HorarioSemanal = {};
  for (const { clave } of DIAS_SEMANA) {
    const t = (o as Record<string, unknown>)[clave] as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") continue;
    const entrada = hora(t.entrada);
    const salida = hora(t.salida);
    if (entrada || salida) out[clave] = { entrada, salida };
  }
  return Object.keys(out).length > 0 ? out : null;
}

const aMin = (h: string | null) => {
  const m = h ? HHMM.exec(h) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** La entrada que corresponde a una fecha (YYYY-MM-DD); null si ese día no trabaja. */
export function entradaDelDia(horario: HorarioSemanal | null, fecha: string): string | null {
  if (!horario) return null;
  const dia = String(new Date(`${fecha.slice(0, 10)}T00:00:00Z`).getUTCDay()) as keyof HorarioSemanal;
  return horario[dia]?.entrada ?? null;
}

/** Horas por semana (solo los días con entrada y salida). */
export function horasSemanales(horario: HorarioSemanal | null): number {
  if (!horario) return 0;
  let min = 0;
  for (const t of Object.values(horario)) {
    const a = aMin(t?.entrada ?? null);
    const b = aMin(t?.salida ?? null);
    if (a != null && b != null && b > a) min += b - a;
  }
  return Math.round((min / 60) * 10) / 10;
}

/** "Lun a Vie 07:00–17:00 · Sáb 07:00–11:00" — los días seguidos con el mismo horario se agrupan. */
export function resumenHorario(horario: HorarioSemanal | null): string {
  if (!horario) return "Sin horario";
  const grupos: Array<{ desde: string; hasta: string; texto: string }> = [];
  for (const { clave, corto } of DIAS_SEMANA) {
    const t = horario[clave];
    if (!t) continue;
    const texto = `${t.entrada ?? "?"}–${t.salida ?? "?"}`;
    const ultimo = grupos[grupos.length - 1];
    const anterior = DIAS_SEMANA[DIAS_SEMANA.findIndex((d) => d.clave === clave) - 1];
    if (ultimo && ultimo.texto === texto && anterior && ultimo.hasta === anterior.corto) ultimo.hasta = corto;
    else grupos.push({ desde: corto, hasta: corto, texto });
  }
  return grupos.map((g) => `${g.desde === g.hasta ? g.desde : `${g.desde} a ${g.hasta}`} ${g.texto}`).join(" · ") || "Sin horario";
}

/** La primera entrada de la semana, para la columna vieja `hora_entrada_prevista`. */
export function entradaPrincipal(horario: HorarioSemanal | null): string | null {
  if (!horario) return null;
  for (const { clave } of DIAS_SEMANA) if (horario[clave]?.entrada) return horario[clave]!.entrada;
  return null;
}
