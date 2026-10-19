/**
 * Límites de día / mes en zona horaria Paraguay (America/Asuncion, UTC-4 fijo,
 * sin horario de verano desde 2024) expresados como ISO UTC, para filtrar
 * columnas timestamptz en SQL (`fecha >= start AND fecha <= end`).
 *
 * Helper neutral en `lib/fechas` (no acoplar Reportes/Compras a otro módulo).
 */

const TZ = "America/Asuncion";

/** YYYY-MM-DD del "hoy" en Asunción. */
function asuncionYmd(now: Date): string {
  // en-CA da formato YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Año y mes (1-12) del "ahora" en Asunción. */
function asuncionYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/** Inicio y fin (inclusive) del día de hoy en Asunción, como ISO UTC. */
export function asuncionDayBoundsUtc(now: Date = new Date()): { start: string; end: string } {
  const ymd = asuncionYmd(now);
  const start = new Date(`${ymd}T00:00:00.000-04:00`);
  const end = new Date(`${ymd}T23:59:59.999-04:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Rango [desde, hasta] (YYYY-MM-DD, en Asunción) como ISO UTC inclusivo.
 * Si falta `desde` u `hasta`, cae al inicio/fin del mes actual respectivamente.
 */
export function asuncionRangeBoundsUtc(
  desde?: string | null,
  hasta?: string | null,
  now: Date = new Date()
): { start: string; end: string } {
  const month = asuncionMonthBoundsUtc(now);
  const start = desde ? new Date(`${desde}T00:00:00.000-04:00`).toISOString() : month.start;
  const end = hasta ? new Date(`${hasta}T23:59:59.999-04:00`).toISOString() : month.end;
  return { start, end };
}

/** Inicio y fin (inclusive) del mes actual en Asunción, como ISO UTC. */
export function asuncionMonthBoundsUtc(now: Date = new Date()): { start: string; end: string } {
  const { year, month } = asuncionYearMonth(now);
  const mm = String(month).padStart(2, "0");
  const start = new Date(`${year}-${mm}-01T00:00:00.000-04:00`);
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextMM = String(nextM).padStart(2, "0");
  const end = new Date(`${nextY}-${nextMM}-01T00:00:00.000-04:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Límites (inclusive) de un mes `YYYY-MM` en Asunción, como ISO UTC. */
export function asuncionMesBoundsUtc(mes: string): { start: string; end: string } {
  const [y, m] = mes.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const start = new Date(`${y}-${mm}-01T00:00:00.000-04:00`);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00.000-04:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Mes actual en Asunción como `YYYY-MM`. */
export function mesActualAsuncion(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

/** Últimos `n` meses (incluye el actual) en Asunción, como `YYYY-MM` desc. */
export function mesesRecientesAsuncion(n: number, now: Date = new Date()): string[] {
  const actual = mesActualAsuncion(now);
  let [y, m] = actual.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** Valida formato `YYYY-MM`; si no, devuelve el mes actual. */
export function normalizarMes(mes?: string | null): string {
  return mes && /^\d{4}-\d{2}$/.test(mes) ? mes : mesActualAsuncion();
}

// ── Helpers para reportes con período semanal / comparación ───────────────────

const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** `YYYY-MM-DD` del "hoy" en Asunción. */
export function hoyAsuncionYmd(now: Date = new Date()): string {
  return asuncionYmd(now);
}

/** Suma (o resta) días a un `YYYY-MM-DD` calendario y devuelve `YYYY-MM-DD`. */
export function sumarDiasYmd(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/** Lunes (inicio) de la semana calendario que contiene `ymd` (lun–dom). */
export function semanaLunesYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom … 6=Sáb
  const desdeLunes = (dow + 6) % 7;
  return sumarDiasYmd(ymd, -desdeLunes);
}

/** Límites timestamptz UTC (inclusive) de un rango `YYYY-MM-DD`..`YYYY-MM-DD` en Asunción. */
export function boundsDeRangoYmd(desde: string, hasta: string): { start: string; end: string } {
  return {
    start: new Date(`${desde}T00:00:00.000-04:00`).toISOString(),
    end: new Date(`${hasta}T23:59:59.999-04:00`).toISOString(),
  };
}

/** Mes anterior a `YYYY-MM`. */
export function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** Mes siguiente a `YYYY-MM`. */
export function mesSiguiente(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Último día (`YYYY-MM-DD`) del mes `YYYY-MM`. */
export function ultimoDiaMes(mes: string): string {
  return sumarDiasYmd(`${mesSiguiente(mes)}-01`, -1);
}

/** Etiqueta larga de un mes `YYYY-MM` → "Agosto 2026". */
export function mesLabelLargo(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_LARGO[m - 1]} ${y}`;
}

/** Etiqueta corta de un rango de fechas → "11–17 ago 2026" / "28 jul – 3 ago 2026". */
export function rangoLabelCorto(desde: string, hasta: string): string {
  const [, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  if (m1 === m2) return `${d1}–${d2} ${MESES_CORTO[m2 - 1]} ${y2}`;
  return `${d1} ${MESES_CORTO[m1 - 1]} – ${d2} ${MESES_CORTO[m2 - 1]} ${y2}`;
}

/** Cantidad de días calendario entre dos `YYYY-MM-DD` (hasta − desde). */
export function diasEntreYmd(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Trimestre (1-4) del mes (1-12). */
function trimestreDeMes(m: number): number {
  return Math.floor((m - 1) / 3) + 1;
}

/** Rango de fechas del trimestre que contiene `ymd`. */
export function asuncionTrimestreDesdeHasta(ymd: string): { desde: string; hasta: string; anio: number; q: number } {
  const [y, m] = ymd.split("-").map(Number);
  const q = trimestreDeMes(m);
  const primerMes = (q - 1) * 3 + 1;
  const ultimoMes = primerMes + 2;
  return {
    desde: `${y}-${String(primerMes).padStart(2, "0")}-01`,
    hasta: ultimoDiaMes(`${y}-${String(ultimoMes).padStart(2, "0")}`),
    anio: y,
    q,
  };
}

/** Rango de fechas del año calendario. */
export function asuncionAnioDesdeHasta(anio: number): { desde: string; hasta: string } {
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
}

/** Etiqueta de día → "12 ago 2026". */
export function diaLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MESES_CORTO[m - 1]} ${y}`;
}

/** Etiqueta de trimestre → "T3 2026 (jul–sep)". */
export function trimestreLabel(anio: number, q: number): string {
  const primerMes0 = (q - 1) * 3;
  return `T${q} ${anio} (${MESES_CORTO[primerMes0]}–${MESES_CORTO[primerMes0 + 2]})`;
}
