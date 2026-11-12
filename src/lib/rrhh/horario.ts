/**
 * Horario semanal del empleado (script 74).
 *
 * Por cada día que trabaja, UNA O VARIAS franjas, con la clave del día de la
 * semana (0 = domingo … 6 = sábado). El día que no está, no trabaja.
 *
 * ── POR QUÉ VARIAS FRANJAS Y NO UNA ────────────────────────────────────────
 *   La primera versión guardaba una sola entrada y una sola salida por día:
 *   {"1": {"entrada": "07:00", "salida": "17:00"}}
 *
 *   Con eso, el horario de la casa —de 7 a 12 y de 13 a 17— no se podía
 *   escribir. O se cargaba 07:00–17:00, que cuenta como trabajadas las dos
 *   horas del mediodía, o se perdía la tarde. Diez horas en vez de nueve, en
 *   todos los recibos.
 *
 *   Ahora el día es una lista:
 *   {"1": [{"entrada": "07:00", "salida": "12:00"},
 *          {"entrada": "13:00", "salida": "17:00"}]}
 *
 * ── LO VIEJO SE SIGUE LEYENDO ──────────────────────────────────────────────
 *   `normalizarHorario` acepta las dos formas: si el día trae un objeto suelto
 *   en vez de una lista, lo envuelve. Así los horarios cargados antes del
 *   cambio —y los que arma la migración del script 74— se leen igual, sin
 *   tener que tocar la base.
 *
 * Módulo puro: lo usan la ficha (para editar y mostrar) y el control horario
 * (para medir la tardanza contra la PRIMERA entrada de ese día).
 */

export type Turno = { entrada: string | null; salida: string | null };
export type DiaClave = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type HorarioSemanal = Partial<Record<DiaClave, Turno[]>>;

export const DIAS_SEMANA: Array<{ clave: DiaClave; corto: string; largo: string }> = [
  { clave: "1", corto: "Lun", largo: "Lunes" },
  { clave: "2", corto: "Mar", largo: "Martes" },
  { clave: "3", corto: "Mié", largo: "Miércoles" },
  { clave: "4", corto: "Jue", largo: "Jueves" },
  { clave: "5", corto: "Vie", largo: "Viernes" },
  { clave: "6", corto: "Sáb", largo: "Sábado" },
  { clave: "0", corto: "Dom", largo: "Domingo" },
];

/** Más de tres franjas en un día no es un horario: es un error de carga. */
export const MAX_TURNOS_POR_DIA = 3;

const CORTADO: Turno[] = [
  { entrada: "07:00", salida: "12:00" },
  { entrada: "13:00", salida: "17:00" },
];

/**
 * El horario de la casa: de 7 a 12 y de 13 a 17 de lunes a viernes, y el
 * sábado corto de 7 a 11. Es el que el cliente pidió poder cargar.
 */
export const HORARIO_SUGERIDO: HorarioSemanal = {
  "1": CORTADO, "2": CORTADO, "3": CORTADO, "4": CORTADO, "5": CORTADO,
  "6": [{ entrada: "07:00", salida: "11:00" }],
};

/** El otro caso común: corrido, sin cortar al mediodía. */
export const HORARIO_CORRIDO: HorarioSemanal = {
  "1": [{ entrada: "07:00", salida: "17:00" }],
  "2": [{ entrada: "07:00", salida: "17:00" }],
  "3": [{ entrada: "07:00", salida: "17:00" }],
  "4": [{ entrada: "07:00", salida: "17:00" }],
  "5": [{ entrada: "07:00", salida: "17:00" }],
  "6": [{ entrada: "07:00", salida: "11:00" }],
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)/;

function hora(v: unknown): string | null {
  const m = HHMM.exec(String(v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

const aMin = (h: string | null) => {
  const m = h ? HHMM.exec(h) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function turno(v: unknown): Turno | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const entrada = hora(t.entrada);
  const salida = hora(t.salida);
  return entrada || salida ? { entrada, salida } : null;
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
    const bruto = (o as Record<string, unknown>)[clave];
    // Un objeto suelto es la forma vieja, de una sola franja por día.
    const lista = Array.isArray(bruto) ? bruto : [bruto];
    const turnos = lista.map(turno).filter((t): t is Turno => t !== null);
    if (turnos.length === 0) continue;
    // Ordenadas por hora de entrada: así la mañana va antes que la tarde
    // aunque se hayan cargado al revés, y la tardanza mira la que debe.
    turnos.sort((a, b) => (aMin(a.entrada) ?? 9999) - (aMin(b.entrada) ?? 9999));
    out[clave] = turnos.slice(0, MAX_TURNOS_POR_DIA);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Las franjas de una fecha (YYYY-MM-DD); vacío si ese día no trabaja. */
export function turnosDelDia(horario: HorarioSemanal | null, fecha: string): Turno[] {
  if (!horario) return [];
  const dia = String(new Date(`${fecha.slice(0, 10)}T00:00:00Z`).getUTCDay()) as DiaClave;
  return horario[dia] ?? [];
}

/**
 * La entrada contra la que se mide la tardanza: la PRIMERA del día.
 *
 * Con horario cortado, el que vuelve tarde del almuerzo no cuenta como
 * tardanza del día. Se mide la llegada a la mañana, que es lo que se venía
 * midiendo y lo que la ficha llama "tolerancia para la entrada".
 */
export function entradaDelDia(horario: HorarioSemanal | null, fecha: string): string | null {
  return turnosDelDia(horario, fecha)[0]?.entrada ?? null;
}

/** Horas por semana, sumando todas las franjas. El corte del mediodía no cuenta. */
export function horasSemanales(horario: HorarioSemanal | null): number {
  if (!horario) return 0;
  let min = 0;
  for (const turnos of Object.values(horario)) {
    for (const t of turnos ?? []) {
      const a = aMin(t.entrada);
      const b = aMin(t.salida);
      if (a != null && b != null && b > a) min += b - a;
    }
  }
  return Math.round((min / 60) * 10) / 10;
}

/** "07:00–12:00 y 13:00–17:00" */
export function textoDelDia(turnos: Turno[] | undefined): string {
  if (!turnos || turnos.length === 0) return "";
  return turnos.map((t) => `${t.entrada ?? "?"}–${t.salida ?? "?"}`).join(" y ");
}

/** "Lun a Vie 07:00–12:00 y 13:00–17:00 · Sáb 07:00–11:00" — días seguidos con el mismo horario se agrupan. */
export function resumenHorario(horario: HorarioSemanal | null): string {
  if (!horario) return "Sin horario";
  const grupos: Array<{ desde: string; hasta: string; texto: string }> = [];
  for (const { clave, corto } of DIAS_SEMANA) {
    const turnos = horario[clave];
    if (!turnos || turnos.length === 0) continue;
    const texto = textoDelDia(turnos);
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
  for (const { clave } of DIAS_SEMANA) {
    const e = horario[clave]?.[0]?.entrada;
    if (e) return e;
  }
  return null;
}
