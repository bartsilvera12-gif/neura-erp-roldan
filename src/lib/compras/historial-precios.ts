/**
 * Historial de precios de un artículo: a cuánto se compró cada vez.
 *
 * Pedido del cliente, con la pantalla del sistema viejo a la vista: poder
 * mirar, para un artículo y un rango de fechas, todas sus compras con
 * proveedor, factura, cantidad, precio en guaraníes, precio en dólares y
 * total, y los totales al pie.
 *
 * Acá están las cuentas, sin base de datos ni React, para poder probarlas
 * (ver `scripts/test-historial-precios.ts`).
 */

/** Una compra del artículo, tal como sale de la tabla `compras`. */
export type FilaHistorial = {
  numero_control: string | null;
  fecha: string | null;
  producto_id: string | null;
  producto_nombre: string | null;
  proveedor_nombre: string | null;
  numero_factura: string | null;
  cantidad: number | null;
  /** Precio unitario en guaraníes (así se guarda siempre). */
  costo_unitario: number | null;
  /** Precio unitario en la moneda de la compra (el que se tipeó). */
  costo_unitario_original: number | null;
  moneda: string | null;
  tipo_cambio: number | null;
  /** Total de la línea, en guaraníes. */
  total: number | null;
};

const num = (v: unknown) => Number(v) || 0;

/**
 * El precio unitario en dólares, o null si la compra no fue en dólares.
 *
 * Una compra en guaraníes no tiene precio en dólares: no se guardó ninguna
 * cotización con ella, y convertirla con la del día sería un número
 * inventado. Se prefiere el precio original (el que se tipeó); si falta
 * —compras viejas— se deduce dividiendo el de guaraníes por el tipo de cambio
 * de esa compra.
 */
export function precioEnDolares(f: Pick<FilaHistorial, "moneda" | "costo_unitario" | "costo_unitario_original" | "tipo_cambio">): number | null {
  if (String(f.moneda ?? "") !== "USD") return null;
  const original = num(f.costo_unitario_original);
  if (original > 0) return original;
  const tc = num(f.tipo_cambio);
  if (tc <= 0) return null;
  const gs = num(f.costo_unitario);
  if (gs <= 0) return null;
  return gs / tc;
}

/** El total de la línea en dólares, o null si la compra no fue en dólares. */
export function totalEnDolares(f: FilaHistorial): number | null {
  const p = precioEnDolares(f);
  if (p == null) return null;
  return p * num(f.cantidad);
}

export type TotalesHistorial = {
  /** Suma de los totales, en guaraníes. */
  gs: number;
  /** Suma de los totales de las compras hechas en dólares. */
  usd: number;
  /** Unidades compradas en total. */
  cantidad: number;
  /** Cuántas compras se están mirando. */
  compras: number;
};

/** Los totales del pie, como en la pantalla del sistema viejo. */
export function totalesHistorial(filas: FilaHistorial[]): TotalesHistorial {
  return filas.reduce<TotalesHistorial>(
    (acc, f) => ({
      gs: acc.gs + num(f.total),
      usd: acc.usd + (totalEnDolares(f) ?? 0),
      cantidad: acc.cantidad + num(f.cantidad),
      compras: acc.compras + 1,
    }),
    { gs: 0, usd: 0, cantidad: 0, compras: 0 }
  );
}

/**
 * Cuánto cambió el precio respecto de la compra anterior, en %.
 *
 * Las filas vienen de la más nueva a la más vieja, así que la «anterior» de
 * la fila `i` es la `i + 1`. Se compara en guaraníes para que una compra en
 * dólares y una en guaraníes se puedan comparar entre sí. Null en la última
 * fila (no hay con qué comparar) o si alguno de los dos precios es 0.
 */
export function variacionPorcentual(filas: FilaHistorial[], i: number): number | null {
  const actual = num(filas[i]?.costo_unitario);
  const anterior = num(filas[i + 1]?.costo_unitario);
  if (actual <= 0 || anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}
