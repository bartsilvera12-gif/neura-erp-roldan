/**
 * Tipos de egreso de caja (punto 5.7).
 *
 * Un egreso sin clasificar no se puede sumar por concepto a fin de mes: la
 * pregunta "¿cuánto se fue en fletes?" obliga a leer los conceptos uno por uno
 * y a adivinar cuáles contaban.
 *
 * La lista es fija y corta a propósito. Una lista que crece sola termina con
 * "flete", "fletes" y "FLETE" como tres categorías distintas, que es peor que
 * no tener ninguna. Lo que no encaja va en "otros" CON motivo escrito, que es
 * lo que pide el punto.
 */

export const TIPOS_EGRESO = [
  { value: "proveedor",  label: "Pago a proveedor" },
  { value: "flete",      label: "Flete / transporte" },
  { value: "sueldo",     label: "Sueldo o adelanto" },
  { value: "servicios",  label: "Servicios (luz, agua, internet)" },
  { value: "impuestos",  label: "Impuestos y tasas" },
  { value: "insumos",    label: "Insumos y gastos de local" },
  { value: "mantenimiento", label: "Mantenimiento y reparaciones" },
  { value: "retiro_socio",  label: "Retiro de socio" },
  { value: "otros",      label: "Otros (con motivo)" },
] as const;

export type TipoEgreso = (typeof TIPOS_EGRESO)[number]["value"];

const VALIDOS = new Set<string>(TIPOS_EGRESO.map((t) => t.value));

export function esTipoEgresoValido(v: unknown): v is TipoEgreso {
  return typeof v === "string" && VALIDOS.has(v);
}

export function etiquetaTipoEgreso(v: string | null | undefined): string {
  if (!v) return "Sin clasificar";
  return TIPOS_EGRESO.find((t) => t.value === v)?.label ?? v;
}

/** Un adjunto de respaldo del egreso: la factura o el recibo. */
export interface AdjuntoEgreso {
  tipo: "factura" | "recibo" | "otro";
  nombre: string;
  path: string | null;
  url: string | null;
}
