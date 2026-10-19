/**
 * Fuente de verdad ÚNICA para "qué productos entran en la valorización de inventario".
 *
 * Definición de negocio (confirmada): el valor de inventario cuenta solo la
 * mercadería con STOCK REAL. Queda fuera el "Menú sin control" — ítems de menú
 * que no controlan stock, no son insumos y no se fabrican-y-stockean
 * (produccion_previa). Reventa (controla_stock) y Materia prima (insumos) sí
 * entran; produccion_previa (menú fabricado y stockeado) también.
 *
 * Usar este predicado en TODAS las pantallas que valoricen inventario para que
 * el número no se desincronice entre el dashboard y el módulo de Inventario.
 */
export function tieneStockRealValorizable(p: {
  controla_stock?: boolean | null;
  es_insumo?: boolean | null;
  modo_receta?: string | null;
}): boolean {
  return !(
    p.controla_stock === false &&
    p.es_insumo !== true &&
    p.modo_receta !== "produccion_previa"
  );
}

/** Valor de inventario (Σ stock_actual × costo_promedio) sobre los productos con stock real. */
export function valorInventario(
  productos: Array<{
    stock_actual: number;
    costo_promedio: number;
    controla_stock?: boolean | null;
    es_insumo?: boolean | null;
    modo_receta?: string | null;
  }>
): number {
  return productos.reduce(
    (s, p) => (tieneStockRealValorizable(p) ? s + p.stock_actual * p.costo_promedio : s),
    0
  );
}
