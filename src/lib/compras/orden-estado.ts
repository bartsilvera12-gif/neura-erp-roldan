/**
 * En qué anda una orden de compra (pedido del cliente):
 *
 *   en_transito  pedida, todavía no llegó
 *   recibida     llegó: se marcó a mano, o ya pasó la fecha de entrega
 *   facturada    se cargó su factura («Cargar factura» → compra)
 *   anulada
 *
 * «Llegada la fecha de entrega, cuenta como recibida» se calcula al leer: no
 * hace falta un proceso que la marque.
 */
export type EstadoOrden = "en_transito" | "recibida" | "facturada" | "anulada";

export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  en_transito: "En tránsito",
  recibida: "Recibida",
  facturada: "Facturada",
  anulada: "Anulada",
};

function hoyPy(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function estadoOrden(o: {
  estado?: string | null;
  compra_numero?: string | null;
  fecha_entrega?: string | null;
}): EstadoOrden {
  if (o.estado === "anulada") return "anulada";
  if (o.compra_numero) return "facturada";
  if (o.estado === "recibida") return "recibida";
  const fe = String(o.fecha_entrega ?? "").slice(0, 10);
  if (fe && fe <= hoyPy()) return "recibida";
  return "en_transito";
}

/** Sin proveedor elegido la orden se guarda con este nombre. */
export const SIN_PROVEEDOR = "SIN PROVEEDOR";
