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

/** Formato legal paraguayo de un número de comprobante: 001-001-0000001. */
export const RE_NUMERO_FACTURA = /^\d{3}-\d{3}-\d{7}$/;

/** El timbrado de la DNIT son 8 dígitos. */
export const RE_TIMBRADO = /^\d{8}$/;

/**
 * Valida el número de comprobante ya formateado. Devuelve el mensaje de error
 * o `null` si está bien. Un número vacío se considera válido: hay comprobantes
 * (tickets internos, notas) que se cargan sin número.
 */
export function errorNumeroFactura(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return RE_NUMERO_FACTURA.test(s)
    ? null
    : "El N° de factura debe tener el formato 001-001-0000001.";
}

/** Idem para el timbrado, que sí es obligatorio en una compra con factura. */
export function errorTimbrado(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/\D+/g, "");
  if (!s) return "Ingresá el N° de timbrado.";
  return RE_TIMBRADO.test(s) ? null : "El N° de timbrado son 8 dígitos.";
}
