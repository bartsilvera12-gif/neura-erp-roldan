/**
 * Quién puede hacer qué, en un solo lugar.
 *
 * Los tres permisos que el cliente separó explícitamente:
 *
 *   - ANULAR una factura y CAMBIAR el tipo de pago cambian números ya
 *     rendidos. No son operación de mostrador.
 *   - El SUPERVISOR existe para controlar: entra a los cierres de caja y
 *     puede anular, pero no edita ni configura.
 *
 * Está acá y no repartido en cada ruta para que la regla se pueda leer de una
 * sola vez. Una regla de permisos copiada en seis archivos es una regla que
 * en el sexto archivo dice otra cosa.
 */

import { isErpRolSupervisor, isErpRolAdministrador } from "@/lib/usuarios/erp-rol-normalize";

export interface AuthConRol {
  rol?: string | null;
}

/** Administrador de la empresa. */
export function esAdministrador(auth: AuthConRol | null | undefined): boolean {
  return isErpRolAdministrador(auth?.rol);
}

/** Supervisor: controla, no opera. */
export function esSupervisor(auth: AuthConRol | null | undefined): boolean {
  return isErpRolSupervisor(auth?.rol);
}

/**
 * Anular una factura: administrador o supervisor.
 *
 * Antes podía hacerlo cualquiera mientras el turno de caja siguiera abierto.
 * Esa regla tenía su lógica —deshacer un error recién cometido— pero deja que
 * el mismo que cobró de más anule y rehaga sin que nadie se entere.
 */
export function puedeAnular(auth: AuthConRol | null | undefined): boolean {
  return esAdministrador(auth) || esSupervisor(auth);
}

/**
 * Cambiar el tipo de pago de una venta ya cobrada: solo administrador.
 *
 * Mueve plata de una columna del arqueo a otra sin tocar el total, así que
 * una caja que no cuadra puede "arreglarse" cambiando el medio en vez de
 * buscar el error.
 */
export function puedeCambiarTipoDePago(auth: AuthConRol | null | undefined): boolean {
  return esAdministrador(auth);
}

/** Editar una venta ya registrada: solo administrador. */
export function puedeEditarVenta(auth: AuthConRol | null | undefined): boolean {
  return esAdministrador(auth);
}
