/**
 * El IVA que viene adentro de un precio.
 *
 * En Paraguay los precios se manejan CON IVA INCLUIDO: los Gs. 110.000 de la
 * etiqueta son Gs. 100.000 del negocio y Gs. 10.000 que se le deben al fisco.
 * Por eso el IVA no se suma: se saca de adentro dividiendo, y la tasa viene
 * del artículo (`productos.tipo_iva`) o de la línea de la venta.
 *
 * Vive acá, y no en comisiones, porque lo necesitan tres cosas distintas
 * —comisiones, margen y los informes de IVA— y tener dos divisores escritos
 * en dos archivos es la forma más barata de que un día no coincidan.
 */

/** Divisor para sacar el IVA de un precio que lo incluye. */
export function divisorIva(tipoIva: string): number {
  if (tipoIva === "10%") return 1.1;
  if (tipoIva === "5%") return 1.05;
  return 1;
}

/** Quita el IVA de un importe que lo incluye. */
export function sinIva(montoConIva: number, tipoIva: string): number {
  return (Number(montoConIva) || 0) / divisorIva(tipoIva);
}

/**
 * Cuánto IVA hay adentro de un importe que lo incluye.
 *
 * Es el complemento de `sinIva`: monto − sinIva(monto). Se escribe así, y no
 * como `monto × tasa`, porque `monto × 10%` sobre un precio que YA tiene el
 * IVA adentro da un número más grande que el IVA real (11.000 en vez de
 * 10.000 sobre 110.000), y ese es el error clásico.
 */
export function ivaIncluido(montoConIva: number, tipoIva: string): number {
  const m = Number(montoConIva) || 0;
  return m - m / divisorIva(tipoIva);
}
