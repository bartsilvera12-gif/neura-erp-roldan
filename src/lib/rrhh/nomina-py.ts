/**
 * Recibo de salario en Paraguay.
 *
 * El recibo venía con la estructura de una nómina española: "devengos",
 * "I.R.P.F.", "productos en especie", "bases de cotización", "coste empresa".
 * Acá no hay IRPF sobre el sueldo; lo que se descuenta es el IPS.
 *
 *   · Salario: el mes se liquida sobre 30 días. Con menos días trabajados se
 *     paga la proporción (salario / 30 × días). Al jornalero, jornal × días.
 *   · IPS: 9% a cargo del trabajador y 16,5% a cargo del empleador, sobre lo
 *     imponible (salario, horas extra, comisiones). Lo no imponible
 *     —bonificación familiar, viáticos— no aporta.
 *   · Todo en guaraníes enteros: el guaraní no tiene decimales.
 *
 * Módulo puro: se usa igual en el servidor (al generar el recibo) y en la
 * pantalla (para ver los totales mientras se edita).
 */

export const IPS_TRABAJADOR_PCT = 9;
export const IPS_PATRONAL_PCT = 16.5;
export const DIAS_MES = 30;

export type Ingreso = {
  concepto: string;
  cantidad: number | null;
  importe_unitario: number | null;
  importe_total: number;
  /** Imponible para IPS (columna `es_salarial`). */
  es_salarial: boolean;
};

export type TipoDescuento = "ips_trabajador" | "ips_patronal" | "prestamo" | "judicial" | "otro";

export type Descuento = {
  tipo: TipoDescuento;
  concepto: string;
  base: number | null;
  tipo_pct: number | null;
  importe: number;
};

const gs = (n: number) => Math.round(Number(n) || 0);

/** Línea de salario del período. */
export function lineaSalario(salarioBase: number, diasTrabajados: number, tipoPeriodo: string | null | undefined): Ingreso {
  const dias = Math.max(0, Math.min(DIAS_MES, Math.trunc(diasTrabajados)));
  if (tipoPeriodo === "jornal") {
    return { concepto: "Jornales", cantidad: dias, importe_unitario: gs(salarioBase), importe_total: gs(salarioBase * dias), es_salarial: true };
  }
  if (dias >= DIAS_MES) {
    return { concepto: "Salario mensual", cantidad: DIAS_MES, importe_unitario: null, importe_total: gs(salarioBase), es_salarial: true };
  }
  const jornal = salarioBase / DIAS_MES;
  return { concepto: "Salario (días trabajados)", cantidad: dias, importe_unitario: gs(jornal), importe_total: gs(jornal * dias), es_salarial: true };
}

export function imponibleIps(ingresos: Ingreso[]): number {
  return ingresos.filter((i) => i.es_salarial).reduce((s, i) => s + gs(i.importe_total), 0);
}

/** Las dos líneas de IPS, calculadas sobre lo imponible. */
export function lineasIps(ingresos: Ingreso[]): Descuento[] {
  const base = imponibleIps(ingresos);
  return [
    { tipo: "ips_trabajador", concepto: "IPS (aporte del trabajador)", base, tipo_pct: IPS_TRABAJADOR_PCT, importe: gs((base * IPS_TRABAJADOR_PCT) / 100) },
    { tipo: "ips_patronal", concepto: "IPS (aporte patronal)", base, tipo_pct: IPS_PATRONAL_PCT, importe: gs((base * IPS_PATRONAL_PCT) / 100) },
  ];
}

/**
 * Reemplaza las líneas de IPS por las recalculadas y deja el resto de los
 * descuentos como están. Así el IPS siempre acompaña a lo que se cobra.
 */
export function conIpsRecalculado(ingresos: Ingreso[], descuentos: Descuento[]): Descuento[] {
  const otros = descuentos.filter((d) => d.tipo !== "ips_trabajador" && d.tipo !== "ips_patronal");
  return [...lineasIps(ingresos), ...otros];
}

export type Totales = {
  total_ingresos: number;
  total_descuentos: number;
  neto: number;
  aporte_patronal: number;
  costo_empresa: number;
};

export function totalesRecibo(ingresos: Ingreso[], descuentos: Descuento[]): Totales {
  const total_ingresos = ingresos.reduce((s, i) => s + gs(i.importe_total), 0);
  const total_descuentos = descuentos.filter((d) => d.tipo !== "ips_patronal").reduce((s, d) => s + gs(d.importe), 0);
  const aporte_patronal = descuentos.filter((d) => d.tipo === "ips_patronal").reduce((s, d) => s + gs(d.importe), 0);
  return {
    total_ingresos,
    total_descuentos,
    neto: total_ingresos - total_descuentos,
    aporte_patronal,
    costo_empresa: total_ingresos + aporte_patronal,
  };
}

/** Recibo listo para revisar: salario del período e IPS. */
export function reciboInicial(salarioBase: number, diasTrabajados: number, tipoPeriodo: string | null | undefined) {
  const ingresos = salarioBase > 0 ? [lineaSalario(salarioBase, diasTrabajados, tipoPeriodo)] : [];
  const descuentos = lineasIps(ingresos);
  return { ingresos, descuentos, totales: totalesRecibo(ingresos, descuentos) };
}

/** "2026-11" → { desde: "2026-11-01", hasta: "2026-11-30" }. */
export function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function nombreMes(mesOFecha: string): string {
  const [y, m] = mesOFecha.slice(0, 7).split("-").map(Number);
  return `${MESES[(m || 1) - 1]} ${y}`;
}
