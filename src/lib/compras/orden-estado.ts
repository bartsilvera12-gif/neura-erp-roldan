/**
 * En qué anda una orden de compra (pedido del cliente):
 *
 *   en_transito    pedida, todavía no llegó
 *   por_confirmar  una persona marcó «Recibido»; falta que el administrador acepte
 *   recibida        llegó: confirmada por DOS personas
 *   facturada      se cargó su factura («Cargar factura» → compra)
 *   anulada
 *
 * DOBLE CONFIRMACIÓN (pedido del cliente)
 *   Para dar una orden por recibida tienen que confirmarlo dos personas
 *   distintas: la que recibe la mercadería marca «Recibido», y un
 *   administrador le da «Aceptar». Con una sola confirmación la orden queda
 *   «Por confirmar», NO recibida.
 *
 *   Antes había dos caminos que daban una orden por recibida sin que nadie la
 *   confirmara, y se sacaron a pedido del cliente porque salteaban el control:
 *     - «llegada la fecha de entrega, cuenta como recibida». Ahora la fecha de
 *       entrega es solo informativa (`entregaAtrasada` la marca como atrasada).
 *     - «Cargar factura la deja recibida». Ahora cargar la factura la deja
 *       `facturada`; la recepción se confirma aparte.
 *
 *   Las órdenes de ANTES de este cambio, que quedaron en `estado = 'recibida'`
 *   con la regla vieja (sin `recibida_por_1_at`), se siguen mostrando
 *   recibidas: no se les toca nada.
 */
export type EstadoOrden = "en_transito" | "por_confirmar" | "recibida" | "facturada" | "anulada";

export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  en_transito: "En tránsito",
  por_confirmar: "Por confirmar",
  recibida: "Recibida",
  facturada: "Facturada",
  anulada: "Anulada",
};

/** Lo que `estadoOrden` necesita leer de una orden. */
export type OrdenParaEstado = {
  estado?: string | null;
  compra_numero?: string | null;
  fecha_entrega?: string | null;
  recibida_por_1_at?: string | null;
  recibida_por_2_at?: string | null;
};

function hoyPy(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function estadoOrden(o: OrdenParaEstado): EstadoOrden {
  if (o.estado === "anulada") return "anulada";
  if (o.compra_numero) return "facturada";
  if (o.recibida_por_2_at) return "recibida";
  if (o.recibida_por_1_at) return "por_confirmar";
  // Órdenes marcadas recibidas con la regla anterior (un solo click): se
  // respetan como están. No tienen rastro de quién las confirmó.
  if (o.estado === "recibida") return "recibida";
  return "en_transito";
}

/**
 * La mercadería tendría que haber llegado y nadie confirmó la recepción.
 * Reemplaza a la regla vieja de darla por recibida sola: avisa, no confirma.
 */
export function entregaAtrasada(o: OrdenParaEstado): boolean {
  const e = estadoOrden(o);
  if (e !== "en_transito") return false;
  const fe = String(o.fecha_entrega ?? "").slice(0, 10);
  return fe !== "" && fe < hoyPy();
}

/** Sin proveedor elegido la orden se guarda con este nombre. */
export const SIN_PROVEEDOR = "SIN PROVEEDOR";
