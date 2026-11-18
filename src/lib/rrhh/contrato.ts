/**
 * Tipos de contrato del empleado.
 *
 * «Facturador» (pedido del cliente): la persona factura sus servicios, no es
 * dependiente, así que NO aporta al IPS — ni el 9% del trabajador ni el
 * patronal. Su recibo sale sin las líneas de IPS.
 */
export const TIPOS_CONTRATO: ReadonlyArray<readonly [string, string]> = [
  ["", "—"],
  ["indefinido", "Por tiempo indefinido"],
  ["temporal", "Plazo fijo"],
  ["prueba", "Período de prueba"],
  ["obra", "Por obra determinada"],
  ["facturador", "Facturador (sin IPS)"],
];

/**
 * ¿Aporta al IPS? No el facturador, ni quien tiene marcado «Sin IPS» en su
 * ficha (script 94: `aporta_ips = false`).
 */
export function aportaIps(tipoContrato: string | null | undefined, aportaIpsFicha?: boolean | null): boolean {
  if (aportaIpsFicha === false) return false;
  return String(tipoContrato ?? "").trim().toLowerCase() !== "facturador";
}

/** Cómo aporta, para el selector de la ficha. */
export type SituacionIps = "aporta" | "facturador" | "sin_ips";

export function situacionIps(tipoContrato: string | null | undefined, aportaIpsFicha?: boolean | null): SituacionIps {
  if (String(tipoContrato ?? "").trim().toLowerCase() === "facturador") return "facturador";
  if (aportaIpsFicha === false) return "sin_ips";
  return "aporta";
}
