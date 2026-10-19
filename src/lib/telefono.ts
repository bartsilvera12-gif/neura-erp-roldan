/**
 * Helpers para formato de teléfono Paraguay (0980000000).
 * Formato visual: 0981 100 453
 * Valor guardado: 0981100453 (sin espacios)
 */

/** Extrae solo dígitos, máximo 10. */
function extractDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

/**
 * Formatea el número para mostrar en pantalla.
 * Ejemplo: "0981100453" → "0981 100 453"
 */
export function formatTelefonoDisplay(value: string): string {
  const d = extractDigits(value);
  if (d.length <= 4) return d;
  if (d.length <= 7) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

/**
 * Limpia el número para guardar en base de datos.
 * Ejemplo: "0981 100 453" → "0981100453"
 */
export function cleanTelefono(value: string): string {
  return extractDigits(value);
}

/**
 * Valida formato Paraguay: 10 dígitos, empieza con 09.
 */
export function isValidTelefono(value: string): boolean {
  const cleaned = cleanTelefono(value);
  return cleaned.length === 10 && cleaned.startsWith("09");
}

/**
 * Dígitos "significativos" de un teléfono paraguayo: sin ceros a la izquierda
 * y sin el prefijo país 595. Sirve para comparar dos números escritos distinto
 * (0981..., +595981..., 595981...) y detectar que son el mismo.
 */
export function telefonoSignificativo(value: string): string {
  let d = cleanTelefono(value).replace(/^0+/, "");
  if (d.startsWith("595")) d = d.slice(3);
  return d;
}
