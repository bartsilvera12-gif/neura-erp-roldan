/**
 * Quién puede anular una venta.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────
 *   ADMINISTRADOR  → cualquier venta, de cualquier turno y de cualquier día.
 *   SUPERVISOR     → solo las de una caja que todavía está ABIERTA.
 *   El resto       → nadie.
 *
 * ── POR QUÉ EL SUPERVISOR NO LLEGA A LO CERRADO ───────────────────────────
 *   Una caja cerrada ya fue contada y arqueada: su diferencia está escrita y
 *   alguien la firmó. Anular una venta de ahí cambia el efectivo esperado de
 *   un turno que ya se cuadró, y el faltante o sobrante que quedó registrado
 *   pasa a no corresponderse con las ventas que lo explican. Eso se corrige,
 *   pero es una decisión de la administración, no del control diario.
 *
 *   Con la caja abierta no hay nada firmado todavía: la venta mal cargada se
 *   detecta en el momento, se anula y el turno cierra bien. Para eso está el
 *   supervisor en el mostrador.
 *
 * ── LO QUE ESTO REEMPLAZA ─────────────────────────────────────────────────
 *   Antes el cajero podía anular las de su propio turno, y después se pasó a
 *   "admin o supervisor, sin mirar el turno". Esta es la tercera versión y la
 *   que pidió el cliente: el administrador sin límites, el supervisor acotado
 *   a lo que todavía se puede corregir sin deshacer un arqueo.
 *
 * Toda anulación queda registrada en `modificaciones_administrativas`, con
 * nombre y motivo, sin importar quién la haya hecho.
 */

export type PermisoAnular =
  | { permitido: true; motivo: null }
  | { permitido: false; motivo: string };

export function puedeAnularVenta(params: {
  esAdmin: boolean;
  /** El supervisor anula, pero solo mientras la caja siga abierta. */
  esSupervisor?: boolean;
  /**
   * Si la caja de ESA venta sigue abierta.
   *
   * `undefined` es "no se pudo averiguar". Se trata como cerrada: ante la duda
   * no se deja anular algo que puede estar arqueado. Una venta sin caja
   * (cargada fuera de un turno) tampoco tiene nada abierto que la contenga.
   */
  cajaAbierta?: boolean;
}): PermisoAnular {
  if (params.esAdmin) return { permitido: true, motivo: null };

  if (params.esSupervisor === true) {
    if (params.cajaAbierta === true) return { permitido: true, motivo: null };
    return {
      permitido: false,
      motivo:
        "El turno de caja de esta venta ya está cerrado y arqueado. " +
        "Anular una venta de un turno cerrado lo hace un administrador.",
    };
  }

  return {
    permitido: false,
    motivo:
      "Anular una factura lo hace un administrador o un supervisor. " +
      "Pedíselo a quien corresponda.",
  };
}
