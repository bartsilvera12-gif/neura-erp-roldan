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

/**
 * Cómo se muestran los estados (pedido del cliente: «que salga aprobado y
 * rechazado nomás, sin la parte de en tránsito y demás»).
 *
 * El flujo NO cambia: por dentro siguen estando `en_transito` y
 * `por_confirmar`, y la doble confirmación funciona igual. Lo que cambia es la
 * palabra: mientras no esté resuelta la orden dice «Pendiente», y las dos
 * puntas se llaman «Aprobado» y «Rechazado».
 *
 * A quién le falta hacer qué se ve en la fila (quién recibió, el botón
 * «Aceptar»), no en la etiqueta del estado.
 */
export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  en_transito: "Pendiente",
  por_confirmar: "Pendiente",
  recibida: "Aprobado",
  facturada: "Facturada",
  anulada: "Rechazado",
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

/** Cuántas confirmaciones de recepción hacen falta. */
export const CONFIRMACIONES_RECEPCION = 2;

/**
 * Cuántas de las dos confirmaciones están hechas, para mostrarlo como «1/2».
 *
 * Una orden anulada no cuenta nada: no hay nada que recibir. Las marcadas
 * recibidas con la regla anterior (un solo click, sin rastro de quién) se
 * muestran completas: ya se dieron por recibidas y no se les va a pedir las
 * dos confirmaciones ahora.
 */
export function confirmacionesHechas(o: OrdenParaEstado): number {
  if (o.estado === "anulada") return 0;
  if (o.recibida_por_2_at) return 2;
  if (o.recibida_por_1_at) return 1;
  if (o.estado === "recibida") return CONFIRMACIONES_RECEPCION;
  return 0;
}

/** «0/2», «1/2» o «2/2». Vacío si la orden está anulada: no aplica. */
export function textoConfirmaciones(o: OrdenParaEstado): string | null {
  if (o.estado === "anulada") return null;
  return `${confirmacionesHechas(o)}/${CONFIRMACIONES_RECEPCION}`;
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
