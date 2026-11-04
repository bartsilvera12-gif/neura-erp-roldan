/**
 * Quién puede reabrir un turno de caja, y cuál.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "El supervisor solo puede acceder a las cajas abiertas del día para
 *   reabrirlas y demás; lo demás puede ver pero no editar."
 *
 * ── POR QUÉ EL CORTE ES EL DÍA Y NO OTRA COSA ──────────────────────────────
 *   Reabrir un turno cambia números que ya se rindieron. Mientras el turno es
 *   de hoy, corregirlo es corregir: la plata sigue en el cajón, el cajero está
 *   ahí y el error se encuentra contando de nuevo. Un turno de la semana pasada
 *   ya se contó, se firmó y se informó; "corregirlo" es cambiar un número que
 *   alguien dio por bueno, y eso es decisión del administrador, no del que
 *   controla el mostrador.
 *
 *   El corte es por FECHA DE APERTURA del turno, no por fecha de cierre: un
 *   turno que abrió anoche y cerró esta madrugada es el turno de anoche, y lo
 *   que se está por tocar es la rendición de anoche.
 *
 * ── PARAGUAY ES SIEMPRE UTC−3 ──────────────────────────────────────────────
 *   En el servidor `new Date()` da UTC. A las 21:00 de Asunción ya es el día
 *   siguiente en UTC, así que comparar fechas en UTC le cerraría la puerta al
 *   supervisor justo en el turno de la noche, que es cuando más falta le hace.
 *   Por eso la fecha se calcula corrida a −3.
 */

/** Paraguay no tiene horario de verano desde 2024: siempre UTC−3. */
const OFFSET_PY_HORAS = -3;

/** El día calendario paraguayo de un instante, como YYYY-MM-DD. */
export function diaParaguay(instante: Date | string): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + OFFSET_PY_HORAS * 3_600_000).toISOString().slice(0, 10);
}

export interface PermisoReabrir {
  /** El usuario es administrador: puede con cualquier turno. */
  esAdmin: boolean;
  /** Tiene la facultad `reabrir_caja` (el supervisor la trae de fábrica). */
  puedeReabrir: boolean;
  /** `fecha_apertura` del turno. */
  fechaApertura?: string | null;
  /** Para poder probarlo sin depender de qué día es hoy. */
  ahora?: Date;
}

export interface Veredicto {
  ok: boolean;
  /** Qué decirle a la persona. Vacío cuando `ok`. */
  motivo: string;
}

export function puedeReabrirCaja({
  esAdmin, puedeReabrir, fechaApertura, ahora,
}: PermisoReabrir): Veredicto {
  if (esAdmin) return { ok: true, motivo: "" };

  if (!puedeReabrir) {
    return { ok: false, motivo: "No tenés la facultad de reabrir turnos de caja." };
  }

  const dia = fechaApertura ? diaParaguay(fechaApertura) : "";
  if (!dia) {
    // Sin fecha no se puede afirmar que sea de hoy, y la duda se resuelve
    // cerrando: dejar pasar un turno viejo es peor que frenar uno de hoy.
    return { ok: false, motivo: "No se pudo determinar de qué día es el turno." };
  }

  const hoy = diaParaguay(ahora ?? new Date());
  if (dia !== hoy) {
    return {
      ok: false,
      motivo:
        "Solo un administrador puede reabrir un turno de otro día. " +
        "Este turno es del " + dia.split("-").reverse().join("/") + ".",
    };
  }

  return { ok: true, motivo: "" };
}

/**
 * Versión para la pantalla: si el botón se muestra o no.
 *
 * Se usa la misma cuenta que el servidor para que no haya botones que fallan
 * al apretarlos. El servidor igual vuelve a verificar: esto es comodidad, no
 * seguridad.
 */
export function muestraBotonReabrir(p: PermisoReabrir): boolean {
  return puedeReabrirCaja(p).ok;
}
