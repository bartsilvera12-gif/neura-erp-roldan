/**
 * Cálculo de días de ausencia según política.
 *
 * - "naturales": todos los días calendario entre las dos fechas, inclusive.
 * - "laborables": solo lunes a viernes (sin festivos por ahora; F2).
 *
 * Fechas en formato ISO YYYY-MM-DD. Devuelve enteros >= 0.
 */
export function calcularDias(
  desde: string,
  hasta: string,
  tipo: "naturales" | "laborables"
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 0;
  if (hasta < desde) return 0;
  const d1 = new Date(`${desde}T00:00:00Z`);
  const d2 = new Date(`${hasta}T00:00:00Z`);
  if (tipo === "naturales") {
    const ms = d2.getTime() - d1.getTime();
    return Math.round(ms / 86_400_000) + 1;
  }
  // laborables: iterar día a día y contar 1-5 (Mon-Fri).
  let count = 0;
  const cur = new Date(d1);
  while (cur.getTime() <= d2.getTime()) {
    const dow = cur.getUTCDay(); // 0=Dom, 6=Sab
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Días generados proporcionalmente desde la fecha de ingreso hasta hoy
 * (o hasta el cierre del año en curso, lo que ocurra antes).
 *
 * Si no hay fecha de ingreso o ya pasó más de un año desde el inicio del año
 * actual, devuelve diasAnuales completo.
 */
export function diasGenerados(
  fechaIngresoIso: string | null,
  diasAnuales: number,
  proporcional: boolean,
  hoyIso?: string
): number {
  if (!proporcional || !fechaIngresoIso || !/^\d{4}-\d{2}-\d{2}$/.test(fechaIngresoIso)) {
    return diasAnuales;
  }
  const hoyStr = hoyIso ?? new Date().toISOString().slice(0, 10);
  const hoy = new Date(`${hoyStr}T00:00:00Z`);
  const año = hoy.getUTCFullYear();
  const inicioAño = new Date(`${año}-01-01T00:00:00Z`);
  const ingreso = new Date(`${fechaIngresoIso}T00:00:00Z`);
  const inicio = ingreso > inicioAño ? ingreso : inicioAño;
  if (inicio > hoy) return 0;
  // Meses COMPLETOS cumplidos desde `inicio` hasta hoy.
  // Solo cuenta un mes cuando ya pasó el día del mes correspondiente al inicio.
  // Ej. inicio 14/06, hoy 16/06 → 0 meses cumplidos. Hoy 14/07 → 1 mes.
  // Redondeo hacia abajo (Math.floor) para no regalar fracciones.
  let meses =
    (hoy.getUTCFullYear() - inicio.getUTCFullYear()) * 12 +
    (hoy.getUTCMonth() - inicio.getUTCMonth());
  if (hoy.getUTCDate() < inicio.getUTCDate()) meses -= 1;
  meses = Math.max(0, Math.min(12, meses));
  const generado = Math.floor((diasAnuales * meses) / 12);
  return Math.max(0, Math.min(diasAnuales, generado));
}
