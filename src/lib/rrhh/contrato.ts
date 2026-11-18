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

/** ¿Aporta al IPS? Todos menos el facturador. */
export function aportaIps(tipoContrato: string | null | undefined): boolean {
  return String(tipoContrato ?? "").trim().toLowerCase() !== "facturador";
}
