/**
 * Una línea de una orden de compra: cantidad, precio y descuento.
 *
 * Pedido del cliente (con la pantalla del sistema viejo a la vista): poder
 * poner descuento por línea, y que al elegir el artículo se traiga todo de su
 * última compra —moneda, precio— más el stock que hay.
 *
 * La cuenta está acá, sin React ni base de datos, para poder probarla
 * (ver `scripts/test-orden-compra-linea.ts`).
 */

export type LineaOrden = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  /** Descuento de la línea, en %. 0 si no tiene. */
  descuento_pct?: number;
  /** Del catálogo, cuando se eligió un artículo y no se escribió a mano. */
  producto_id?: string | null;
  sku?: string | null;
};

/** El descuento vale entre 0 y 100: ni negativo ni más que el total. */
export function descuentoValido(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Lo que vale la línea antes del descuento. */
export function subtotalLinea(l: Pick<LineaOrden, "cantidad" | "precio_unitario">): number {
  return (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0);
}

/** Cuánta plata descuenta la línea. */
export function montoDescuento(l: Pick<LineaOrden, "cantidad" | "precio_unitario" | "descuento_pct">): number {
  return subtotalLinea(l) * (descuentoValido(l.descuento_pct) / 100);
}

/** Lo que se le va a pagar al proveedor por esta línea. */
export function totalLinea(l: Pick<LineaOrden, "cantidad" | "precio_unitario" | "descuento_pct">): number {
  return subtotalLinea(l) - montoDescuento(l);
}

/** Total de la orden, ya con los descuentos de cada línea. */
export function totalOrden(lineas: Array<Pick<LineaOrden, "cantidad" | "precio_unitario" | "descuento_pct">>): number {
  return lineas.reduce((s, l) => s + totalLinea(l), 0);
}

/** Lo que se descontó en toda la orden. */
export function totalDescuento(lineas: Array<Pick<LineaOrden, "cantidad" | "precio_unitario" | "descuento_pct">>): number {
  return lineas.reduce((s, l) => s + montoDescuento(l), 0);
}

/** La última compra de un artículo, como la devuelve la API. */
export type UltimaCompraProducto = {
  moneda?: string | null;
  tipo_cambio?: number | null;
  costo_unitario_original?: number | null;
  costo_unitario?: number | null;
  cantidad?: number | null;
  fecha?: string | null;
  proveedor_nombre?: string | null;
  numero_factura?: string | null;
};

/**
 * Qué se propone al elegir un artículo, a partir de su última compra.
 *
 * El precio que se propone es el ORIGINAL, en la moneda de esa compra: si la
 * vez pasada fueron 20 dólares, se propone 20, no los guaraníes equivalentes.
 * Si falta el original (compras viejas), se cae al costo en guaraníes, y
 * entonces la moneda propuesta es PYG, porque ese número está en guaraníes.
 */
export function propuestaDesdeUltimaCompra(
  u: UltimaCompraProducto | null | undefined
): { precio: number; moneda: "PYG" | "USD" } | null {
  if (!u) return null;
  const original = Number(u.costo_unitario_original) || 0;
  if (original > 0) {
    return { precio: original, moneda: u.moneda === "USD" ? "USD" : "PYG" };
  }
  const enGs = Number(u.costo_unitario) || 0;
  if (enGs > 0) return { precio: enGs, moneda: "PYG" };
  return null;
}
