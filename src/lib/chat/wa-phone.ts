/** Solo dígitos, sin prefijo + */
export function normalizeWaPhone(waId: string): string {
  return waId.replace(/\D/g, "");
}

/**
 * ¿El valor guardado como `phone_number` es un @lid de WhatsApp y NO un teléfono?
 *
 * Contexto: desde WhatsApp 2024+, los chats de clientes que no están agregados a los
 * contactos del celular vinculado llegan identificados con un `@lid` (código interno
 * privado). Si WhatsApp no revela el teléfono real, se guarda el LID como
 * `phone_number` y queda a la vista en el inbox como "117308928352399".
 *
 * Regla: los teléfonos reales caben en 13 dígitos (código país + número); cualquier
 * cosa de 14+ dígitos es casi con seguridad un LID. El caso extremo de 18 dígitos con
 * prefijo `120363...` es directamente un JID de GRUPO de WhatsApp.
 *
 * Si el día de mañana WhatsApp inventa un país con 14+ dígitos, acá se afina.
 */
export function esLidWhatsapp(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return false;
  return digits.length > 13;
}

/**
 * Teléfono mostrable: devuelve el número si es real, "" si es un LID.
 * El que llama decide qué poner en su lugar.
 */
export function telefonoLegibleOVacio(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  if (!p) return "";
  return esLidWhatsapp(p) ? "" : p;
}

/**
 * Qué mostrar como título de un chat: el nombre si lo hay, el teléfono si es
 * uno real, y si solo tenemos un LID, un texto genérico.
 *
 * Existe para no repetir `nombre || telefono || "Contacto"`, que es lo que
 * hacía aparecer códigos de quince dígitos como si fueran el nombre del
 * cliente.
 */
export function nombreParaMostrar(
  nombre: string | null | undefined,
  telefono: string | null | undefined,
  telefonoReal?: string | null,
  fallback = "Sin nombre"
): string {
  const n = (nombre ?? "").trim();
  // Un "nombre" que es el mismo LID no es un nombre.
  if (n && !esLidWhatsapp(n)) return n;
  const real = (telefonoReal ?? "").trim();
  if (real) return real;
  const t = telefonoLegibleOVacio(telefono);
  if (t) return t;
  return fallback;
}
