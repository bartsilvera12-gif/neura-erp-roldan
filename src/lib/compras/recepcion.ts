/**
 * «Recibido» de una orden de compra, con DOBLE CONFIRMACIÓN (pedido del
 * cliente): para dar la mercadería por recibida tienen que confirmarlo dos
 * personas distintas.
 *
 *   1ª confirmación   la hace cualquiera que tenga Compras: quien recibe la
 *                     mercadería marca «Recibido». La orden queda
 *                     «Por confirmar».
 *   2ª confirmación   la hace un ADMINISTRADOR, que recibe el aviso en la
 *                     campana y le da «Aceptar». Tiene que ser otra persona:
 *                     el mismo que marcó no puede aceptarse a sí mismo.
 *
 * Acá está solo la regla, sin base de datos, para poder probarla sola (ver
 * `scripts/test-recepcion-doble.ts`). Quien la aplica es
 * `app/api/ordenes-compra/route.ts`.
 *
 * Las columnas las agrega el script 100. Sin ese script no hay dónde anotar
 * las confirmaciones: ver `recepcionDisponible`.
 */

export type ActorRecepcion = {
  /** Id del usuario que está confirmando. */
  usuarioId: string | null;
  nombre: string | null;
  esAdmin: boolean;
};

export type OrdenRecepcion = {
  estado?: string | null;
  compra_numero?: string | null;
  recibida_por_1?: string | null;
  recibida_por_1_at?: string | null;
  recibida_por_2?: string | null;
  recibida_por_2_at?: string | null;
};

export type ResultadoRecepcion =
  | { ok: true; patch: Record<string, unknown>; paso: 1 | 2 }
  | { ok: false; error: string; status: 400 | 403 | 409 };

/** La primera confirmación ya está y falta la segunda. */
export function esperandoSegunda(o: OrdenRecepcion): boolean {
  return !!o.recibida_por_1_at && !o.recibida_por_2_at;
}

/**
 * Qué pasa cuando alguien le da a «Recibido» / «Aceptar».
 * `ahora` se pasa para poder probar con una fecha fija.
 */
export function confirmarRecepcion(
  o: OrdenRecepcion,
  actor: ActorRecepcion,
  ahora: string = new Date().toISOString()
): ResultadoRecepcion {
  if (!actor.usuarioId) {
    return { ok: false, error: "No se pudo identificar al usuario.", status: 400 };
  }
  if (o.estado === "anulada") {
    return { ok: false, error: "La orden está anulada.", status: 409 };
  }
  if (o.recibida_por_2_at) {
    return { ok: false, error: "Esta orden ya la confirmaron dos personas.", status: 409 };
  }

  // Primera confirmación: la puede hacer cualquiera.
  if (!o.recibida_por_1_at) {
    return {
      ok: true,
      paso: 1,
      patch: {
        recibida_por_1: actor.usuarioId,
        recibida_por_1_nombre: actor.nombre ?? null,
        recibida_por_1_at: ahora,
      },
    };
  }

  // Segunda confirmación.
  if (!actor.esAdmin) {
    return {
      ok: false,
      error: "Falta que un administrador acepte la recepción.",
      status: 403,
    };
  }
  if (o.recibida_por_1 && o.recibida_por_1 === actor.usuarioId) {
    return {
      ok: false,
      error: "Tiene que aceptarlo otra persona: esta orden la marcaste vos.",
      status: 409,
    };
  }
  return {
    ok: true,
    paso: 2,
    patch: {
      recibida_por_2: actor.usuarioId,
      recibida_por_2_nombre: actor.nombre ?? null,
      recibida_por_2_at: ahora,
      // `recibida_at` es de antes (script 97) y se conserva: cuándo quedó
      // recibida. Ahora es el momento de la segunda confirmación.
      recibida_at: ahora,
      estado: "recibida",
    },
  };
}

/**
 * Volver la orden a «En tránsito», borrando las confirmaciones.
 *
 * Mientras falta la segunda, la puede deshacer quien la marcó (se equivocó de
 * orden) o un administrador. Una vez confirmada por los dos, solo un
 * administrador: si no, cualquiera podría desarmar lo que el administrador
 * aceptó.
 */
export function deshacerRecepcion(o: OrdenRecepcion, actor: ActorRecepcion): ResultadoRecepcion {
  if (!actor.usuarioId) {
    return { ok: false, error: "No se pudo identificar al usuario.", status: 400 };
  }
  const limpiar = {
    recibida_por_1: null,
    recibida_por_1_nombre: null,
    recibida_por_1_at: null,
    recibida_por_2: null,
    recibida_por_2_nombre: null,
    recibida_por_2_at: null,
    recibida_at: null,
    estado: "pendiente",
  };

  if (o.recibida_por_2_at) {
    if (!actor.esAdmin) {
      return {
        ok: false,
        error: "Solo un administrador puede volver a tránsito una orden ya confirmada.",
        status: 403,
      };
    }
    return { ok: true, paso: 2, patch: limpiar };
  }

  if (o.recibida_por_1_at) {
    const propia = !!o.recibida_por_1 && o.recibida_por_1 === actor.usuarioId;
    if (!actor.esAdmin && !propia) {
      return {
        ok: false,
        error: "Esto lo deshace quien marcó la orden, o un administrador.",
        status: 403,
      };
    }
    return { ok: true, paso: 1, patch: limpiar };
  }

  // Órdenes marcadas con la regla anterior (un solo click, sin rastro de
  // quién): las deshace un administrador.
  if (o.estado === "recibida" && !actor.esAdmin) {
    return {
      ok: false,
      error: "Solo un administrador puede volver a tránsito una orden ya confirmada.",
      status: 403,
    };
  }
  return { ok: true, paso: 1, patch: limpiar };
}

/** Qué botón le toca a quien está mirando la orden. */
export function accionesRecepcion(
  o: OrdenRecepcion,
  actor: Pick<ActorRecepcion, "usuarioId" | "esAdmin">
): { confirmar: boolean; aceptar: boolean; deshacer: boolean; esperandoOtro: boolean } {
  if (o.estado === "anulada") {
    return { confirmar: false, aceptar: false, deshacer: false, esperandoOtro: false };
  }
  if (o.recibida_por_2_at) {
    return { confirmar: false, aceptar: false, deshacer: actor.esAdmin, esperandoOtro: false };
  }
  if (o.recibida_por_1_at) {
    const propia = !!o.recibida_por_1 && o.recibida_por_1 === actor.usuarioId;
    const puedeAceptar = actor.esAdmin && !propia;
    return {
      confirmar: false,
      aceptar: puedeAceptar,
      deshacer: actor.esAdmin || propia,
      esperandoOtro: !puedeAceptar,
    };
  }
  // Marcada con la regla anterior.
  if (o.estado === "recibida") {
    return { confirmar: false, aceptar: false, deshacer: actor.esAdmin, esperandoOtro: false };
  }
  return { confirmar: true, aceptar: false, deshacer: false, esperandoOtro: false };
}
