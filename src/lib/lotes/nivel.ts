/**
 * Helpers de urgencia por vencimiento de lote.
 * Regla:
 *   - critico     ≤7  días  (rojo)
 *   - proximo     ≤15 días  (ámbar)  → dispara la campanita del header
 *   - advertencia ≤30 días  (amarillo suave)
 *   - ok          >30 días  (o sin fecha)
 * Vencidos (dias_restantes < 0) se consideran críticos.
 */

export type NivelVencimiento = "critico" | "proximo" | "advertencia" | "ok";

export const UMBRAL_CRITICO = 7;
export const UMBRAL_PROXIMO = 15;
export const UMBRAL_ADVERTENCIA = 30;

/** Devuelve los días restantes entre `hoy` (00:00 UTC) y la fecha ISO `YYYY-MM-DD`. */
export function diasRestantes(fechaVencimientoIso: string, hoy: Date = new Date()): number {
  // Parseamos como fecha "pura" (sin hora) para no ensuciar con TZ.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaVencimientoIso);
  if (!m) return Number.POSITIVE_INFINITY;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const venc = Date.UTC(y, mo, d);
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const diff = venc - hoyUtc;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

export function nivelPorDias(dias: number): NivelVencimiento {
  if (dias <= UMBRAL_CRITICO) return "critico";
  if (dias <= UMBRAL_PROXIMO) return "proximo";
  if (dias <= UMBRAL_ADVERTENCIA) return "advertencia";
  return "ok";
}
