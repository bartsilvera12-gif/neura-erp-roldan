/**
 * Un número escrito a mano, como lo escribe la gente de acá.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *   `Number("2,5")` es NaN. En Paraguay la coma es el separador decimal: el
 *   que carga una comisión del dos y medio escribe "2,5", y el sistema le
 *   decía que el valor no servía.
 *
 *   Antes el campo era `<input type="number" step="0.5">`, y ahí el navegador
 *   ni siquiera dejaba escribir: cualquier valor que no cayera justo en un
 *   múltiplo de medio punto —2,3 por ejemplo— daba "Please enter a valid
 *   value. The two nearest valid values are 2 and 2.5", un cartel en inglés
 *   que no explica nada y que el usuario no puede resolver.
 *
 * ── QUÉ ACEPTA ─────────────────────────────────────────────────────────────
 *   "2,5" · "2.5" · " 2,5 " · "2" · "" (vacío = sin dato, no cero).
 *   Lo que no sea un número devuelve `null`, y quien llama decide qué decir.
 */
export function numeroDecimal(texto: unknown): number | null {
  const s = String(texto ?? "").trim();
  if (!s) return null;
  // La coma de los decimales. Los puntos se dejan como están: nadie escribe
  // separador de miles en un porcentaje, y "1.500" como mil quinientos en un
  // campo de 0 a 100 no tiene sentido.
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
