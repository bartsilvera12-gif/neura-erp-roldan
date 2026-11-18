/** Tope de líneas de una compra (pedido del cliente). Pantalla y servidor usan el mismo. */
export const MAX_ITEMS_COMPRA = 20;

export function mensajeTopeCompra(): string {
  return `Una compra lleva hasta ${MAX_ITEMS_COMPRA} ítems. Para más, cargá otra compra.`;
}
