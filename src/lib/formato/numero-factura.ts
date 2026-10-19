/**
 * Formatea un número de factura al esquema paraguayo NNN-NNN-NNNNNNN.
 * Acepta input parcial (mientras el usuario tipea) y va agregando los guiones
 * a medida que el largo alcanza los cortes 3 y 6. Ignora caracteres no numéricos.
 * Trunca al máximo de 13 dígitos.
 */
export function formatearNumeroFactura(raw: string): string {
  const digits = (raw ?? "").replace(/\D+/g, "").slice(0, 13);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Idem para display de un número guardado: si ya viene con guiones, respeta;
 * si viene solo con dígitos, aplica el formato. Útil para tablas y comprobantes.
 */
export function displayNumeroFactura(v: string | null | undefined): string {
  if (!v) return "";
  if (v.includes("-")) return v;
  return formatearNumeroFactura(v);
}
