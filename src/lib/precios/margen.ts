/**
 * Margen y remarcación (punto 1.7).
 *
 * SON DOS NÚMEROS DISTINTOS Y SE CONFUNDEN TODO EL TIEMPO
 *
 *   Costo 100.000, precio 150.000:
 *     remarcación = 50.000 / 100.000 = 50%   ← cuánto se le puso ENCIMA AL COSTO
 *     margen      = 50.000 / 150.000 = 33,3% ← qué parte DE LA VENTA es ganancia
 *
 *   Es la misma plata mirada desde dos lados. Confundirlas es caro en las dos
 *   direcciones: pedir "40% de ganancia" pensando en remarcación y aplicarlo
 *   como margen deja un precio más alto del acordado; al revés, deja uno más
 *   bajo y se vende perdiendo sin que nadie lo note.
 *
 *   Por eso en pantalla van las dos, con su nombre, y nunca una sola rotulada
 *   de forma ambigua.
 *
 * CUÁL SE USA PARA QUÉ
 *   Para FIJAR un precio se piensa en remarcación: "al costo le pongo 60%".
 *   Para medir RENTABILIDAD se usa el margen: es la parte de la facturación
 *   que queda. El punto 4.4 (comisión según rentabilidad) necesita el margen.
 */

/** Qué parte de la venta es ganancia: (precio − costo) / precio × 100. */
export function margenSobreVenta(costo: number, precio: number): number {
  const p = Number(precio) || 0;
  if (p <= 0) return 0;
  return (((p - (Number(costo) || 0)) / p) * 100);
}

/**
 * Cuánto se le puso encima al costo: (precio − costo) / costo × 100.
 *
 * Sin costo cargado no existe: devuelve null en vez de cero, porque "0% de
 * remarcación" significa que se vende al costo, y eso es una afirmación
 * distinta de "no sabemos cuánto costó".
 */
export function remarcacionSobreCosto(costo: number, precio: number): number | null {
  const c = Number(costo) || 0;
  if (c <= 0) return null;
  return (((Number(precio) || 0) - c) / c) * 100;
}

/** Precio que resulta de aplicarle una remarcación al costo. */
export function precioDesdeRemarcacion(costo: number, remarcacionPct: number): number {
  return (Number(costo) || 0) * (1 + (Number(remarcacionPct) || 0) / 100);
}

/** Ganancia en guaraníes por unidad. */
export function gananciaUnitaria(costo: number, precio: number): number {
  return (Number(precio) || 0) - (Number(costo) || 0);
}

/**
 * Color según el margen. Los cortes son los que ya usaba Inventario, para no
 * cambiarle el significado a algo que la gente viene leyendo.
 *
 * El negativo se separa: no es "margen bajo", es venta a pérdida.
 */
export function colorMargen(margen: number): string {
  if (margen < 0) return "text-rose-600";
  if (margen >= 40) return "text-green-600";
  if (margen >= 20) return "text-yellow-600";
  return "text-red-600";
}

/** Formatea un porcentaje, o "—" cuando no se puede calcular. */
export function pct(valor: number | null, decimales = 1): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  return `${valor.toFixed(decimales)}%`;
}
