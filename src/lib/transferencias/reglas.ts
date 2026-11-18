import { normalizeErpRolSlug } from "@/lib/usuarios/erp-rol-normalize";

/**
 * Reglas del cliente para remisiones y transferencias (pantalla y servidor
 * usan las mismas).
 *
 *  - El usuario normal (rol `usuario`) VE las remisiones y transferencias de
 *    su sucursal, y puede despacharlas o recibirlas, pero no crearlas.
 *  - El total en guaraníes de una transferencia lo ve solo administración.
 *  - Hasta 15 ítems por remisión y por transferencia.
 */

export const MAX_ITEMS_REMISION = 15;
export const MAX_ITEMS_TRANSFERENCIA = 15;

export function mensajeTope(cual: "remisión" | "transferencia", max: number): string {
  return `Una ${cual} lleva hasta ${max} ítems. Para más, hacé otra.`;
}

/** ¿Puede crear remisiones y transferencias? Todos menos el usuario normal. */
export function puedeCrearRemision(rol: string | null | undefined): boolean {
  if (rol == null || String(rol).trim() === "") return false;
  return normalizeErpRolSlug(rol) !== "usuario";
}

/** ¿Ve el total en guaraníes? Solo administración. */
export function veTotalTransferencia(rol: string | null | undefined): boolean {
  const r = normalizeErpRolSlug(rol);
  return r === "administrador" || r === "admin" || r === "super_admin";
}
