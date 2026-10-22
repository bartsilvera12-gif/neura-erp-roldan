/**
 * Helpers de fecha calendario en zona horaria de Paraguay (America/Asuncion).
 *
 * Por qué: el server de prod corre en UTC. Usar `new Date()` /
 * `toISOString().slice(0,10)` para "hoy" o como default de formularios hace que,
 * después de ~21:00 PY (medianoche UTC), las fechas salten al día UTC siguiente
 * y las métricas/resúmenes "de hoy" dejen de reflejar ventas/gastos del día PY.
 *
 * Estos helpers usan `Intl` con `timeZone: America/Asuncion`, así que son
 * correctos sin importar el TZ del runtime (server o browser) y sin hardcodear
 * el offset (UTC-3/UTC-4).
 */

export const APP_TIMEZONE = "America/Asuncion";

/** Fecha calendario de Paraguay como `YYYY-MM-DD` (apta para <input type="date"> y comparación). */
export function hoyAsuncionYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/**
 * `YYYY-MM-DD` (en Paraguay) del instante representado por `value` (ISO/Date).
 *
 * Si `value` ya es una fecha calendario (`YYYY-MM-DD`) se devuelve intacta:
 * convertirla restaba un día, porque JS la parsea como medianoche UTC.
 */
export function asuncionYmd(value: string | number | Date): string {
  if (esFechaCalendario(value)) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** ¿`iso` cae en el mismo día calendario (Paraguay) que `now`? */
export function esMismoDiaAsuncion(iso: string, now: Date = new Date()): boolean {
  const a = asuncionYmd(iso);
  return a !== "" && a === hoyAsuncionYmd(now);
}

// ---------------------------------------------------------------------------
// Formato para mostrar en pantalla
// ---------------------------------------------------------------------------
//
// POR QUÉ ESTO EXISTE
//   `new Date("2026-10-21")` NO es la medianoche local: el estándar obliga a
//   interpretar las cadenas `YYYY-MM-DD` como UTC. Al formatearlas en Paraguay
//   (UTC-3) caen el día anterior a las 21:00, así que una factura emitida el
//   21/10 se imprimía como 20/10. Pasaba en facturas, vencimientos, libros
//   fiscales, vacaciones, nómina y fichajes: cada pantalla tenía su propio
//   `fmtFecha` con el mismo `new Date(iso).toLocaleDateString(...)`.
//
//   La distinción que hay que respetar:
//     - "2026-10-21"            → fecha calendario. No tiene hora ni zona:
//                                 se muestra tal cual, sin pasar por Date.
//     - "2026-10-21T20:00:34Z"  → instante. Sí se convierte a la fecha
//                                 calendario que le corresponde en Paraguay.

/** Fecha calendario sin hora, tal como la guarda una columna `date` de Postgres. */
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿`value` es una fecha calendario `YYYY-MM-DD` (sin hora)? */
export function esFechaCalendario(value: unknown): value is string {
  return typeof value === "string" && YMD_RE.test(value.trim());
}

/**
 * `YYYY-MM-DD` para comparar o mandar al backend.
 * Una fecha calendario se devuelve intacta; un instante se baja al día de Paraguay.
 */
export function aFechaCalendario(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  if (esFechaCalendario(value)) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/**
 * Fecha para mostrar en pantalla, en `DD/MM/AAAA`.
 * Es el único formateador de fechas de la app: no volver a escribir
 * `new Date(iso).toLocaleDateString(...)` en una pantalla.
 */
export function formatFecha(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const ymd = aFechaCalendario(value);
  if (!ymd) return fallback;
  const m = YMD_RE.exec(ymd);
  if (!m) return fallback;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Fecha y hora en Paraguay (`DD/MM/AAAA, HH:MM`). Solo para instantes reales
 * (`created_at` y similares). Si le llega una fecha calendario devuelve solo
 * la fecha, porque inventarle una hora sería mentir.
 */
export function formatFechaHora(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  if (value == null) return fallback;
  if (esFechaCalendario(value)) return formatFecha(value, fallback);
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleString("es-PY", {
    timeZone: APP_TIMEZONE,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
