/**
 * Hasta cuándo aparta mercadería una reserva (script 89).
 *
 * Por defecto, 3 días contando hoy; el usuario puede elegir otra fecha.
 * Las reservas anteriores al script no tienen fecha y no vencen: se dejan
 * como estaban para no soltar mercadería que alguien prometió.
 */

export const RESERVA_DIAS_POR_DEFECTO = 3;

/** Hoy en Paraguay (UTC−3), como YYYY-MM-DD. */
export function hoyPy(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD más `dias` días. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** La fecha que se propone al reservar: hoy y dos días más (3 días). */
export function reservaHastaPorDefecto(): string {
  return sumarDias(hoyPy(), RESERVA_DIAS_POR_DEFECTO - 1);
}

/** ¿La reserva sigue apartando mercadería hoy? */
export function reservaVigente(reservado: unknown, hasta: unknown): boolean {
  if (reservado !== true) return false;
  const h = hasta == null ? "" : String(hasta).slice(0, 10);
  return h === "" || h >= hoyPy();
}

/** dd/mm/aaaa, para mostrar. */
export function fechaCorta(iso: unknown): string {
  const s = iso == null ? "" : String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
