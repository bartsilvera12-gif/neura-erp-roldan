/**
 * Aguinaldo en Paraguay (Código del Trabajo, art. 243): la doceava parte de
 * lo que el trabajador COBRÓ en el año calendario. No es un sueldo más: es
 * lo realmente ganado ÷ 12.
 *
 * Por eso lo que no se pagó no entra: los días de reposo (los paga el IPS,
 * no la empresa), los permisos sin goce y demás ausencias bajan lo cobrado
 * del mes y, con eso, el aguinaldo. Las vacaciones NO restan: son pagas.
 *
 * Cada mes se toma así:
 *   · Si tiene recibo de salario: lo que dice el recibo (líneas imponibles:
 *     salario, horas extra, comisiones). Es el salario real.
 *   · Si no: se estima con el salario de la ficha, menos los días de
 *     ausencia del mes y los días antes de su ingreso o después de su baja.
 *
 * Módulo puro: lo usan la API y las pruebas.
 */

export const TIPOS_QUE_DESCUENTAN = new Set(["reposo", "permiso", "otro", "baja"]);

export type AusenciaSimple = { fecha_desde: string; fecha_hasta: string; tipo: string };

export type MesAguinaldo = {
  mes: string; // YYYY-MM
  fuente: "recibo" | "estimado" | "fuera";
  dias_ausencia: number;
  dias_pagados: number;
  monto: number;
};

export type ResultadoAguinaldo = {
  meses: MesAguinaldo[];
  total_cobrado: number;
  aguinaldo: number;
  dias_ausencia: number;
};

const DIAS_MES = 30;
const gs = (n: number) => Math.round(Number(n) || 0);

function ultimoDia(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1;
}

/** Días corridos del mes que caen dentro de ausencias que descuentan (sin contar dos veces). */
export function diasAusenciaEnMes(ausencias: AusenciaSimple[], mes: string): number {
  const ini = `${mes}-01`, fin = ultimoDia(mes);
  const marcados = new Set<string>();
  for (const a of ausencias) {
    if (!TIPOS_QUE_DESCUENTAN.has(a.tipo)) continue;
    const d = a.fecha_desde.slice(0, 10) > ini ? a.fecha_desde.slice(0, 10) : ini;
    const h = a.fecha_hasta.slice(0, 10) < fin ? a.fecha_hasta.slice(0, 10) : fin;
    if (d > h) continue;
    for (let t = Date.parse(`${d}T12:00:00Z`); t <= Date.parse(`${h}T12:00:00Z`); t += 86_400_000) {
      marcados.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  return Math.min(DIAS_MES, marcados.size);
}

/**
 * Días que corresponde pagar del mes, sobre la base de 30: los que está en la
 * empresa (ingreso/baja) menos las ausencias.
 */
export function diasPagablesMes(mes: string, ingreso: string | null, baja: string | null, ausencia: number): number {
  const ini = `${mes}-01`, fin = ultimoDia(mes);
  if ((ingreso && ingreso > fin) || (baja && baja < ini)) return 0;
  let enEmpresa = DIAS_MES;
  if (ingreso && ingreso > ini) enEmpresa = Math.min(DIAS_MES, dias(ingreso, fin));
  if (baja && baja < fin) enEmpresa = Math.min(enEmpresa, dias(ini, baja), DIAS_MES);
  return Math.max(0, enEmpresa - ausencia);
}

export function calcularAguinaldo(args: {
  anio: number;
  /** Último mes que se cuenta (1-12). Para ver lo acumulado a hoy, el mes actual. */
  hastaMes: number;
  salarioBase: number;
  tipoPeriodo: string | null;
  ingreso: string | null;
  baja: string | null;
  /** Lo imponible de cada recibo del año, por mes "YYYY-MM". */
  recibos: Map<string, number>;
  ausencias: AusenciaSimple[];
}): ResultadoAguinaldo {
  const meses: MesAguinaldo[] = [];
  for (let m = 1; m <= Math.max(1, Math.min(12, args.hastaMes)); m++) {
    const mes = `${args.anio}-${String(m).padStart(2, "0")}`;
    const aus = diasAusenciaEnMes(args.ausencias, mes);
    const pagables = diasPagablesMes(mes, args.ingreso, args.baja, aus);
    const conRecibo = args.recibos.get(mes);
    if (conRecibo != null) {
      meses.push({ mes, fuente: "recibo", dias_ausencia: aus, dias_pagados: pagables, monto: gs(conRecibo) });
      continue;
    }
    const fuera = pagables === 0 && aus === 0;
    let monto: number;
    if (args.tipoPeriodo === "jornal") monto = args.salarioBase * pagables;
    else monto = pagables >= DIAS_MES ? args.salarioBase : (args.salarioBase / DIAS_MES) * pagables;
    meses.push({ mes, fuente: fuera ? "fuera" : "estimado", dias_ausencia: aus, dias_pagados: pagables, monto: gs(monto) });
  }
  const total = meses.reduce((s, x) => s + x.monto, 0);
  return {
    meses,
    total_cobrado: total,
    aguinaldo: gs(total / 12),
    dias_ausencia: meses.reduce((s, x) => s + x.dias_ausencia, 0),
  };
}
