/**
 * Cómo se agrupan los movimientos manuales en la Caja (pedido del cliente:
 * cada tipo en su columna, con sus detalles abajo).
 *
 * «Cobranza» es el `ingreso` de siempre con el nombre que usa el cliente.
 * La retención tiene su tipo (script 95); sin el script se guarda como un
 * ingreso con medio «otro» y el concepto «Retención …», y se reconoce por eso.
 */
export type ClaseMovimiento = "cobranza" | "egreso" | "retiro" | "retencion" | "ajuste";

export const RE_CONCEPTO_RETENCION = /^retenci[oó]n\b/i;

export function claseMovimiento(m: { tipo: string; concepto?: string | null }): ClaseMovimiento {
  if (m.tipo === "retencion") return "retencion";
  if (m.tipo === "ingreso") return RE_CONCEPTO_RETENCION.test(m.concepto ?? "") ? "retencion" : "cobranza";
  if (m.tipo === "egreso" || m.tipo === "retiro" || m.tipo === "ajuste") return m.tipo;
  return "ajuste";
}

export const ETIQUETA_CLASE: Record<ClaseMovimiento, string> = {
  cobranza: "Cobranzas",
  egreso: "Egresos",
  retiro: "Retiros",
  retencion: "Retenciones",
  ajuste: "Ajustes",
};
