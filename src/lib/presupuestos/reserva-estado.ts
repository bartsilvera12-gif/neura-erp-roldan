/**
 * Cuándo un presupuesto aparta mercadería, según su estado.
 *
 * La misma regla la necesitaban tres lugares —el cambio de estado, la lectura
 * de la reserva y el cálculo del stock reservado— y estaba escrita tres veces.
 * Acá está una sola, sin base de datos, para que no se puedan desincronizar
 * y para poder probarla (ver `scripts/test-reserva-rechazado.ts`).
 */

/** Estados en los que el presupuesto NO aparta nada, tenga la marca o no. */
const ESTADOS_SIN_RESERVA = ["rechazado", "anulado", "convertido"] as const;

/**
 * Al pasar a este estado hay que SACAR la marca de reserva (script 86).
 *
 * Pedido del cliente: si el cliente rechaza el presupuesto, la mercadería se
 * libera. Antes la marca solo la quitaba un administrador a mano, así que un
 * presupuesto rechazado seguía mostrándose reservado.
 *
 * `convertido` no entra: ahí el stock ya salió de verdad al facturar, y la
 * marca se deja como rastro de lo que pasó.
 */
export function estadoLiberaReserva(estado: string | null | undefined): boolean {
  return String(estado ?? "") === "rechazado";
}

/**
 * El presupuesto no aparta mercadería por su estado (o porque ya se cobró),
 * sin importar la marca. Cubre los que quedaron con la marca puesta antes de
 * que rechazar la sacara, sin tener que tocarles los datos.
 */
export function noApartaPorEstado(
  estado: string | null | undefined,
  convertidoVentaId?: string | null
): boolean {
  if (convertidoVentaId != null && String(convertidoVentaId) !== "") return true;
  return (ESTADOS_SIN_RESERVA as readonly string[]).includes(String(estado ?? ""));
}
