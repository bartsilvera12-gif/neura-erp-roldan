/**
 * Las cuentas de la ficha de producto: costo en dólares, remarcación y
 * descuentos.
 *
 * Son funciones puras a propósito. La misma cuenta se usa en tres lados —el
 * formulario mientras se escribe, la ficha del producto y la planilla de
 * stock— y si se escribe tres veces, a la primera corrección dos de los tres
 * quedan diciendo otra cosa.
 */

/** Resultado de leer un número que viene de un input o de la base. */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Costo en guaraníes a partir del costo en dólares y la cotización.
 *
 * Se usa la cotización VENDEDOR: para pagarle al proveedor del exterior hay
 * que comprarle los dólares al banco, y el banco los vende a ese precio. Con
 * la compradora el costo saldría más bajo que lo que realmente se pagó.
 */
export function costoGsDesdeUsd(
  costoUsd: string | number | null | undefined,
  cotizacionVenta: string | number | null | undefined
): number | null {
  const c = num(costoUsd);
  const tc = num(cotizacionVenta);
  if (c === null || tc === null || c <= 0 || tc <= 0) return null;
  return c * tc;
}

/** Equivalente en dólares de un importe en guaraníes. */
export function aUsd(
  montoGs: string | number | null | undefined,
  cotizacion: string | number | null | undefined
): number | null {
  const m = num(montoGs);
  const tc = num(cotizacion);
  if (m === null || tc === null || tc <= 0 || m === 0) return null;
  return m / tc;
}

/**
 * Precio de venta que sale de un costo y un porcentaje de remarcación.
 *
 * Es la cuenta del sistema anterior: 6,38 × 1,20 = 7,656. Se acepta un
 * porcentaje negativo porque vender por debajo del costo es una decisión que
 * a veces se toma (liquidar mercadería parada), y bloquearla acá obligaría a
 * cargar el precio por otro lado sin dejar registro del motivo.
 */
export function precioDesdeMarkup(
  costo: string | number | null | undefined,
  markupPct: string | number | null | undefined
): number | null {
  const c = num(costo);
  const m = num(markupPct);
  if (c === null || m === null || c <= 0) return null;
  return c * (1 + m / 100);
}

/** El porcentaje de remarcación que hay entre un costo y un precio ya cargados. */
export function markupDesdePrecio(
  costo: string | number | null | undefined,
  precio: string | number | null | undefined
): number | null {
  const c = num(costo);
  const p = num(precio);
  if (c === null || p === null || c <= 0) return null;
  return ((p - c) / c) * 100;
}

/**
 * El descuento del artículo y del rubro ya NO se aplican al precio.
 *
 * Eran un porcentaje que se descontaba solo en cada venta —un rubro al 4%
 * salía con el 4% regalado sin que nadie lo decidiera—. El cliente aclaró que
 * ese número es un TOPE: hasta cuánto se puede bajar. La resolución vive en
 * `@/lib/precios/tope-descuento` (`topeDeLista`, `topeAplicable`).
 *
 * `descuentoEfectivo` se borró a propósito en vez de dejarlo sin uso: con la
 * función ahí, el próximo que necesite "el descuento del artículo" la vuelve
 * a llamar y el 4% vuelve a aplicarse solo.
 */

/** Precio ya con el descuento aplicado, redondeado a guaraní entero. */
export function precioConDescuento(
  precio: string | number | null | undefined,
  descuentoPct: string | number | null | undefined
): number | null {
  const p = num(precio);
  const d = num(descuentoPct) ?? 0;
  if (p === null || p <= 0) return null;
  if (d <= 0) return Math.round(p);
  return Math.round(p * (1 - d / 100));
}

/**
 * Precio de lista en guaraníes de un producto.
 *
 * ── EL GUARANÍ QUEDA FIJO DESDE QUE SE CARGA ──────────────────────────────
 *   Un producto con precio en dólares guarda también su equivalente en
 *   guaraníes (`precio_venta`), calculado con la cotización del momento en que
 *   se cargó o se cambió el precio. Ese es el precio de venta.
 *
 *   Antes se recalculaba al vender con la cotización del día: cambiar el dólar
 *   en el Dashboard cambiaba el precio de los 939 productos en dólares que ya
 *   estaban cargados. Pedido del cliente: lo ya cargado conserva el cambio de
 *   cuando se cargó.
 *
 *   Solo si el producto no tiene guaraní guardado (vacío, cero o negativo, como
 *   los −1,14 de la migración) se convierte con la cotización que se pase.
 */
export function precioListaGs(
  p: { precio_venta?: number | string | null; precio_usd?: number | string | null },
  cotizacionVenta: number | null | undefined
): number {
  const gs = num(p.precio_venta);
  if (gs !== null && gs > 0) return Math.round(gs);
  const usd = num(p.precio_usd);
  const tc = num(cotizacionVenta);
  if (usd !== null && usd > 0 && tc !== null && tc > 0) {
    return Math.round(usd * tc);
  }
  return Math.round(gs ?? 0);
}

/** ¿Este producto tiene el precio puesto en dólares? */
export function precioEnDolares(p: { precio_usd?: number | string | null }): boolean {
  const usd = num(p.precio_usd);
  return usd !== null && usd > 0;
}
