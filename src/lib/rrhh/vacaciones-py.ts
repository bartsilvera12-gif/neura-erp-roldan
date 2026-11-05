/**
 * Vacaciones según la ley paraguaya (Código del Trabajo, Ley 213/93, art. 218).
 *
 * El módulo vino armado con reglas de España: 30 días naturales al año,
 * generados en proporción al año calendario y repartidos 15 de la empresa y
 * 15 del empleado. En Paraguay es otra cosa:
 *
 *   · El derecho nace después de CADA AÑO de trabajo continuo, contado desde
 *     la fecha de ingreso (el aniversario), no por año calendario.
 *   · Cuántos días según la antigüedad:
 *         hasta 5 años ..................... 12 días hábiles
 *         más de 5 y hasta 10 años ........ 18 días hábiles
 *         más de 10 años .................. 30 días hábiles
 *   · Días hábiles: de lunes a SÁBADO. No cuentan domingos ni feriados.
 *   · Se pueden acumular hasta dos períodos (por acuerdo escrito). Lo que tenga
 *     más de dos períodos no se suma al saldo.
 *
 * Módulo puro, sin base de datos: así se prueba con casos armados a mano.
 * Fechas en ISO YYYY-MM-DD.
 */

export const PERIODOS_ACUMULABLES = 2;

/** Días que corresponden al período que cierra al cumplir `anios` de antigüedad. */
export function diasPorAntiguedad(anios: number): number {
  if (anios <= 5) return 12;
  if (anios <= 10) return 18;
  return 30;
}

const RE = /^\d{4}-\d{2}-\d{2}$/;
const aDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date) => d.toISOString().slice(0, 10);

/** Suma años respetando el 29/02 (cae el 28/02 en años no bisiestos). */
export function sumarAnios(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return aIso(new Date(Date.UTC(y + n, m - 1, Math.min(d, ultimoDia))));
}

/** Años completos entre ingreso y hoy. */
export function aniosCumplidos(ingreso: string, hoy: string): number {
  if (!RE.test(ingreso) || !RE.test(hoy) || hoy < ingreso) return 0;
  let n = Number(hoy.slice(0, 4)) - Number(ingreso.slice(0, 4));
  if (sumarAnios(ingreso, n) > hoy) n -= 1;
  return Math.max(0, n);
}

/** "3 años y 2 meses", "8 meses", "12 días". */
export function antiguedadTexto(ingreso: string | null, hoy: string): string | null {
  if (!ingreso || !RE.test(ingreso) || hoy < ingreso) return null;
  const anios = aniosCumplidos(ingreso, hoy);
  const desdeAniv = sumarAnios(ingreso, anios);
  let meses = (Number(hoy.slice(0, 4)) - Number(desdeAniv.slice(0, 4))) * 12 + (Number(hoy.slice(5, 7)) - Number(desdeAniv.slice(5, 7)));
  if (Number(hoy.slice(8, 10)) < Number(desdeAniv.slice(8, 10))) meses -= 1;
  meses = Math.max(0, meses);
  if (anios === 0 && meses === 0) {
    const dias = Math.round((aDate(hoy).getTime() - aDate(ingreso).getTime()) / 86_400_000);
    return `${dias} día${dias === 1 ? "" : "s"}`;
  }
  const a = anios > 0 ? `${anios} año${anios === 1 ? "" : "s"}` : "";
  const m = meses > 0 ? `${meses} mes${meses === 1 ? "" : "es"}` : "";
  return [a, m].filter(Boolean).join(" y ");
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(anio: number): Date {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/**
 * Feriados nacionales de fecha fija de Paraguay, más Jueves y Viernes Santo.
 *
 * Los que el Poder Ejecutivo suele trasladar por decreto (1 de marzo, 12 de
 * junio, 29 de septiembre) NO van acá: su fecha cambia de un año al otro y se
 * cargan en RRHH → Feriados con el día que realmente no se trabaja.
 */
export function feriadosFijosPy(anio: number): string[] {
  const p = pascua(anio);
  const jueves = new Date(p); jueves.setUTCDate(p.getUTCDate() - 3);
  const viernes = new Date(p); viernes.setUTCDate(p.getUTCDate() - 2);
  return [
    `${anio}-01-01`, // Año Nuevo
    `${anio}-05-01`, // Día del Trabajador
    `${anio}-05-14`, // Independencia
    `${anio}-05-15`, // Independencia / Día de la Madre
    `${anio}-08-15`, // Fundación de Asunción
    `${anio}-12-08`, // Virgen de Caacupé
    `${anio}-12-25`, // Navidad
    aIso(jueves),    // Jueves Santo
    aIso(viernes),   // Viernes Santo
  ];
}

/**
 * Días hábiles entre dos fechas, inclusive: lunes a sábado, sin domingos ni
 * feriados (los fijos de arriba más los que se pasen cargados).
 */
export function diasHabilesPy(desde: string, hasta: string, feriadosCargados: Iterable<string> = []): number {
  if (!RE.test(desde) || !RE.test(hasta) || hasta < desde) return 0;
  const feriados = new Set<string>(feriadosCargados);
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a++) {
    for (const f of feriadosFijosPy(a)) feriados.add(f);
  }
  let n = 0;
  const cur = aDate(desde);
  const fin = aDate(hasta);
  while (cur.getTime() <= fin.getTime()) {
    if (cur.getUTCDay() !== 0 && !feriados.has(aIso(cur))) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

/**
 * El día que vuelve a trabajar: el primer día hábil después de `hasta`
 * (salteando domingos y feriados). Va en la comunicación de vacaciones.
 */
export function diaDeReintegroPy(hasta: string, feriadosCargados: Iterable<string> = []): string {
  if (!RE.test(hasta)) return hasta;
  const feriados = new Set<string>(feriadosCargados);
  const cur = aDate(hasta);
  for (let i = 0; i < 30; i++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const iso = aIso(cur);
    if (!feriados.has(iso) && !feriadosFijosPy(cur.getUTCFullYear()).includes(iso) && cur.getUTCDay() !== 0) return iso;
  }
  return aIso(cur);
}

/** Días corridos (calendario) entre dos fechas, inclusive. */
export function diasCorridos(desde: string, hasta: string): number {
  if (!RE.test(desde) || !RE.test(hasta) || hasta < desde) return 0;
  return Math.round((aDate(hasta).getTime() - aDate(desde).getTime()) / 86_400_000) + 1;
}

export type UsoVacaciones = { fecha_desde: string; dias: number };

export type SaldoVacacionesPy = {
  /** Años completos de antigüedad. */
  anios: number;
  antiguedad: string | null;
  /** Días por año que le corresponden hoy según su antigüedad (el próximo período). */
  dias_por_anio: number;
  /** Días de los períodos cumplidos que siguen vigentes (hasta dos). */
  dias_generados: number;
  /** Días de vacaciones tomados desde que empezó el período vigente más viejo. */
  dias_usados: number;
  /** generados − usados. Negativo = se le adelantaron días. */
  dias_disponibles: number;
  /** Desde cuándo cuentan los períodos vigentes (aniversario más viejo). */
  vigente_desde: string | null;
  /** Cuándo genera el próximo período y cuántos días trae. */
  proximo_derecho_fecha: string | null;
  proximo_derecho_dias: number;
};

/**
 * Saldo de vacaciones al día `hoy`.
 *
 * Ejemplo: ingresó el 10/03/2020, hoy 05/11/2026 → 6 años cumplidos. Vigentes
 * los períodos que cerraron el 10/03/2025 (5 años → 12 días) y el 10/03/2026
 * (6 años → 18 días): 30 días, menos lo tomado desde el 10/03/2025.
 */
export function saldoVacacionesPy(
  fechaIngreso: string | null,
  hoy: string,
  usos: UsoVacaciones[],
  acumulables = PERIODOS_ACUMULABLES
): SaldoVacacionesPy {
  if (!fechaIngreso || !RE.test(fechaIngreso)) {
    return {
      anios: 0, antiguedad: null, dias_por_anio: 12, dias_generados: 0, dias_usados: 0,
      dias_disponibles: 0, vigente_desde: null, proximo_derecho_fecha: null, proximo_derecho_dias: 12,
    };
  }
  const anios = aniosCumplidos(fechaIngreso, hoy);
  const primero = Math.max(1, anios - acumulables + 1);
  let generados = 0;
  for (let k = primero; k <= anios; k++) generados += diasPorAntiguedad(k);

  // Sin año cumplido todavía, lo tomado cuenta desde el ingreso (adelanto).
  const vigenteDesde = anios >= 1 ? sumarAnios(fechaIngreso, primero) : fechaIngreso;
  const usados = usos
    .filter((u) => u.fecha_desde >= vigenteDesde)
    .reduce((s, u) => s + (Number(u.dias) || 0), 0);

  return {
    anios,
    antiguedad: antiguedadTexto(fechaIngreso, hoy),
    dias_por_anio: diasPorAntiguedad(anios + 1),
    dias_generados: generados,
    dias_usados: usados,
    dias_disponibles: generados - usados,
    vigente_desde: anios >= 1 ? vigenteDesde : null,
    proximo_derecho_fecha: sumarAnios(fechaIngreso, anios + 1),
    proximo_derecho_dias: diasPorAntiguedad(anios + 1),
  };
}
