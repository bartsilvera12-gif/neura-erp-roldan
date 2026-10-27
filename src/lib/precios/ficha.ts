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

export interface DescuentoResuelto {
  /** Porcentaje que efectivamente se aplica. */
  pct: number;
  /** De dónde salió, para poder mostrarlo y que nadie tenga que adivinar. */
  origen: "articulo" | "rubro" | "ninguno";
}

/**
 * Qué descuento corresponde a un artículo.
 *
 * ── POR QUÉ EL DEL ARTÍCULO MANDA, Y NO SE SUMAN ─────────────────────────
 *   Sumarlos haría que un artículo con 5% propio dentro de un rubro al 4%
 *   salga al 9%, que no es lo que nadie quiso decir al cargar los dos: el
 *   descuento del rubro es el que vale "salvo que este artículo diga otra
 *   cosa". Por eso el del artículo reemplaza al del rubro en vez de sumarse.
 *
 *   Un artículo en 0 no está diciendo "sin descuento", está diciendo "no
 *   tengo el mío": cae al del rubro. Para que un artículo quede SIN descuento
 *   dentro de un rubro que sí lo tiene, hay que bajar el del rubro — que es
 *   justamente la conversación que conviene tener antes de regalar margen en
 *   un solo artículo y que nadie se entere.
 */
export function descuentoEfectivo(
  descuentoArticulo: string | number | null | undefined,
  descuentoRubro: string | number | null | undefined
): DescuentoResuelto {
  const a = num(descuentoArticulo) ?? 0;
  if (a > 0) return { pct: a, origen: "articulo" };
  const r = num(descuentoRubro) ?? 0;
  if (r > 0) return { pct: r, origen: "rubro" };
  return { pct: 0, origen: "ninguno" };
}

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
 * ── POR QUÉ NO ALCANZA CON `precio_venta` ─────────────────────────────────
 *   Un producto con `precio_usd` cargado se vende en dólares: su precio en
 *   guaraníes es el dólar por la cotización del día, y cambia cuando cambia
 *   el dólar. `precio_venta` guarda el equivalente del último guardado, que
 *   sirve para que los informes viejos muestren algo con sentido, pero no es
 *   el precio de hoy.
 *
 *   Sin cotización a mano se cae a `precio_venta`: es el último valor
 *   conocido y está cerca. Vender a cero porque no se pudo leer el tipo de
 *   cambio sería mucho peor.
 *
 * Sin redondeo, por decisión del cliente: el precio es exactamente el dólar
 * por la cotización, al guaraní entero porque no existe la fracción.
 */
export function precioListaGs(
  p: { precio_venta?: number | string | null; precio_usd?: number | string | null },
  cotizacionVenta: number | null | undefined
): number {
  const usd = num(p.precio_usd);
  const tc = num(cotizacionVenta);
  if (usd !== null && usd > 0 && tc !== null && tc > 0) {
    return Math.round(usd * tc);
  }
  return Math.round(num(p.precio_venta) ?? 0);
}

/** ¿Este producto tiene el precio puesto en dólares? */
export function precioEnDolares(p: { precio_usd?: number | string | null }): boolean {
  const usd = num(p.precio_usd);
  return usd !== null && usd > 0;
}
