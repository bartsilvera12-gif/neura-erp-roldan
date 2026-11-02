/**
 * Quién puede anular una venta.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────
 *   Anular una factura lo hace un ADMINISTRADOR o un SUPERVISOR. Nadie más.
 *
 * ── POR QUÉ CAMBIÓ ────────────────────────────────────────────────────────
 *   Antes el cajero podía anular una venta de SU turno abierto, y solo las de
 *   turnos cerrados exigían administrador. La idea era no frenar el
 *   mostrador: una venta mal cargada se detecta en el momento, con el cliente
 *   delante, y pedir que venga alguien con permiso para cada error de tipeo
 *   convierte un problema de diez segundos en una cola.
 *
 *   El cliente pidió lo contrario, y tiene su razón: esa misma puerta deja que
 *   quien cobró de más anule y rehaga la venta sin que nadie se entere. Por
 *   eso anular pasa a ser de quien controla, y el supervisor existe
 *   justamente para que el control no dependa de que el administrador esté
 *   disponible.
 *
 *   La contracara hay que decirla: ahora un error de tipeo en el mostrador
 *   espera a que haya un supervisor o un administrador a mano. Es el costo
 *   que se eligió pagar.
 *
 * El turno de caja ya no entra en la decisión: con la regla nueva, quién
 * anula no depende de cuándo se hizo la venta. Toda anulación queda además
 * registrada en `modificaciones_administrativas`, con nombre y motivo.
 */

export type PermisoAnular =
  | { permitido: true; motivo: null }
  | { permitido: false; motivo: string };

export function puedeAnularVenta(params: {
  esAdmin: boolean;
  /** El supervisor también puede anular: su trabajo es controlar. */
  esSupervisor?: boolean;
}): PermisoAnular {
  if (params.esAdmin || params.esSupervisor === true) {
    return { permitido: true, motivo: null };
  }
  return {
    permitido: false,
    motivo:
      "Anular una factura lo hace un administrador o un supervisor. " +
      "Pedíselo a quien corresponda.",
  };
}
