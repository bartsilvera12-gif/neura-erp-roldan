/**
 * Quién puede hacer una devolución, y quién puede anularla.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ───────────────────────────────────────────────
 *   "Devoluciones: requieren autorización (no liberadas)."
 *
 *   Hasta acá no las pedía nadie: cualquiera con acceso a Caja podía abrir
 *   una venta, marcar productos y confirmar. Eso saca mercadería del registro
 *   de vendido, la devuelve al stock y —si es reembolso— saca plata del cajón
 *   en el acto. Es la única operación del sistema por donde salía dinero sin
 *   que nadie lo aprobara.
 *
 * ── LA REGLA, QUE ES LA MISMA QUE PARA ANULAR UNA VENTA ───────────────────
 *   Una devolución es, en plata, una anulación parcial: deshace parte de una
 *   venta ya cobrada. Se le aplica el mismo criterio que a `puedeAnularVenta`
 *   para que no haya dos reglas distintas para la misma clase de acto.
 *
 *   HACERLA:
 *     ADMINISTRADOR → sí.
 *     SUPERVISOR    → sí. Para eso está en el mostrador: el cliente vuelve
 *                     con la mercadería y alguien tiene que resolver en el
 *                     momento. La devolución ya exige una caja abierta, así
 *                     que siempre cae dentro de un turno en curso.
 *     El resto      → no. El cajero arma la devolución y la autoriza quien
 *                     corresponde; no se la autoriza a sí mismo.
 *
 *   ANULARLA (deshacer la devolución):
 *     ADMINISTRADOR → cualquiera.
 *     SUPERVISOR    → solo mientras el turno de esa devolución siga ABIERTO.
 *     El resto      → no.
 *
 *   El supervisor no llega a lo cerrado por el mismo motivo que en las
 *   ventas: una caja cerrada ya fue contada, arqueada y firmada. Deshacer una
 *   devolución de ahí cambia el efectivo esperado de un turno que ya se
 *   cuadró, y la diferencia que quedó escrita deja de corresponderse con los
 *   movimientos que la explican.
 */

export type PermisoDevolucion =
  | { permitido: true; motivo: null }
  | { permitido: false; motivo: string };

const NI_UNO_NI_OTRO =
  "Una devolución la autoriza un supervisor o un administrador: devuelve " +
  "mercadería al stock y saca plata de la caja. Pedile a quien corresponda " +
  "que la confirme.";

/**
 * Hacer una devolución: hace falta la facultad `autorizar_devolucion`.
 *
 * Quién la tiene lo decide el perfil del usuario, y quien no tiene perfil la
 * hereda de su nivel: administrador y supervisor sí, el resto no, que es lo
 * que el sistema hacía antes de que existieran los perfiles.
 */
export function puedeDevolver(params: { autoriza: boolean }): PermisoDevolucion {
  if (params.autoriza) return { permitido: true, motivo: null };
  return { permitido: false, motivo: NI_UNO_NI_OTRO };
}

/**
 * Anular una devolución ya hecha.
 *
 * `cajaAbierta` undefined es "no se pudo averiguar", y se trata como cerrada:
 * ante la duda no se deshace algo que puede estar arqueado.
 */
export function puedeAnularDevolucion(params: {
  /** Tiene la facultad Y además es administrador: sin límite de turno. */
  esAdmin: boolean;
  /** Tiene la facultad, sin ser administrador: acotado al turno abierto. */
  autoriza?: boolean;
  cajaAbierta?: boolean;
}): PermisoDevolucion {
  if (params.esAdmin) return { permitido: true, motivo: null };

  if (params.autoriza === true) {
    if (params.cajaAbierta === true) return { permitido: true, motivo: null };
    return {
      permitido: false,
      motivo:
        "El turno de caja de esta devolución ya está cerrado y arqueado. " +
        "Deshacerla lo hace un administrador.",
    };
  }

  return {
    permitido: false,
    motivo:
      "Deshacer una devolución la hace un supervisor —mientras el turno siga " +
      "abierto— o un administrador.",
  };
}
