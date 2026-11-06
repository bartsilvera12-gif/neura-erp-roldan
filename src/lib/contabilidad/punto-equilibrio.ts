/**
 * Punto de equilibrio: cuánto hay que vender para cubrir los gastos.
 *
 * ── LO QUE PIDIÓ JOAQUÍN ───────────────────────────────────────────────────
 *   1. Tomar del mes anterior: venta total, gastos totales y el porcentaje de
 *      rentabilidad bruta.
 *   2. Proyectar el mes siguiente con los MISMOS gastos y el MISMO margen.
 *   3. Contestar: "¿cuánto tengo que facturar para que la ganancia cubra
 *      exactamente los gastos?"
 *
 *   Y lo que enfatizó: el resultado es una referencia que dice EN QUÉ MOMENTO
 *   DEL MES ya se cubrieron los gastos, y de ahí en adelante se gana.
 *
 * ── LA CUENTA ──────────────────────────────────────────────────────────────
 *     ventas necesarias = gastos / margen
 *
 *   Con 30% de margen y 30 de gastos, hay que vender 100: de esos 100, 30 son
 *   ganancia bruta, que es justo lo que se va en gastos.
 *
 * ── POR QUÉ TODO ACÁ ES NETO, SIN IVA ──────────────────────────────────────
 *   El IVA que se le cobra al cliente no es ingreso: se le pasa al fisco. Un
 *   punto de equilibrio calculado sobre el total con IVA pediría vender menos
 *   de lo que de verdad hace falta, y el error es del orden del 10%.
 *
 * ── EL MARGEN ES EL NÚMERO FRÁGIL ──────────────────────────────────────────
 *   Todo el resultado cuelga del margen, y el margen cuelga del costo. Si el
 *   margen baja de 20% a 10%, el punto de equilibrio se DUPLICA. Por eso la
 *   pantalla lo muestra como lo que es —un supuesto— y deja cambiarlo: quien
 *   conoce el negocio puede saber mejor que el sistema.
 */

export interface MesBase {
  /** Ventas sin IVA del mes que se toma de referencia. */
  ventas_netas: number;
  /** Costo de lo vendido, sin IVA. */
  cmv: number;
  /** Gastos operativos del mes. NO incluye el pago a proveedores. */
  gastos: number;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Margen bruto en porcentaje: qué parte de cada guaraní vendido queda después
 * de pagar la mercadería.
 *
 * `null` cuando no se puede calcular —sin ventas no hay margen— en vez de
 * cero, que significaría "vende todo al costo" y es una afirmación distinta.
 */
export function margenBrutoPct(base: { ventas_netas: unknown; cmv: unknown }): number | null {
  const v = n(base.ventas_netas);
  if (v <= 0) return null;
  return ((v - n(base.cmv)) / v) * 100;
}

/**
 * EL MARGEN, CON LA FÓRMULA DEL CLIENTE
 *
 *     margen = (lo vendido − el costo de venta) − (IVA de las ventas − IVA del costo)
 *
 * Todo con IVA, como se factura y como se compra: "lo que vendiste, menos el
 * costo de venta, y a esa diferencia se le resta la diferencia de IVA". La
 * diferencia de IVA es lo que se le paga al fisco por esa venta (el IVA que
 * se cobró menos el que ya se pagó al comprar la mercadería): no es ganancia.
 *
 * El porcentaje es sobre lo vendido (facturado con IVA), así el punto de
 * equilibrio sale directamente en "cuánto hay que facturar".
 */
export interface MargenDeVenta {
  vendido: number;
  costo: number;
  /** vendido − costo. */
  diferencia: number;
  iva_debito: number;
  iva_credito: number;
  /** iva_debito − iva_credito: lo que se va al fisco. */
  diferencia_iva: number;
  /** diferencia − diferencia_iva. */
  margen: number;
  /** margen / vendido × 100. null sin ventas. */
  margen_pct: number | null;
}

export function margenDeVenta(b: { vendido: unknown; costo: unknown; iva_debito: unknown; iva_credito: unknown }): MargenDeVenta {
  const vendido = n(b.vendido), costo = n(b.costo), deb = n(b.iva_debito), cred = n(b.iva_credito);
  const diferencia = vendido - costo;
  const diferencia_iva = deb - cred;
  const margen = diferencia - diferencia_iva;
  return {
    vendido, costo, diferencia, iva_debito: deb, iva_credito: cred, diferencia_iva, margen,
    margen_pct: vendido > 0 ? (margen / vendido) * 100 : null,
  };
}

export type MotivoSinPunto = "sin_margen" | "margen_negativo" | "sin_gastos";

export interface Resultado {
  /** Lo que hay que facturar, con IVA. `null` si no se puede calcular. */
  ventas_necesarias: number | null;
  /** Por qué no se pudo, cuando `ventas_necesarias` es null. */
  motivo?: MotivoSinPunto;
  /** El margen con el que se calculó, en porcentaje. */
  margen_pct: number | null;
  /** Los gastos que hay que cubrir. */
  gastos: number;
}

/**
 * Cuánto hay que vender para cubrir los gastos.
 *
 * ── EL MARGEN NEGATIVO NO SE CALCULA, SE DENUNCIA ──────────────────────────
 *   Si se vende por debajo del costo no hay punto de equilibrio: vender MÁS
 *   agranda la pérdida. La fórmula daría un número negativo que, puesto en
 *   pantalla, se leería como una meta. No hay meta: hay que arreglar el
 *   precio o el costo.
 */
export function calcularPuntoEquilibrio({
  gastos, margenPct,
}: { gastos: unknown; margenPct: number | null }): Resultado {
  const g = n(gastos);
  const m = margenPct == null ? null : n(margenPct);

  if (m == null || m === 0) {
    return { ventas_necesarias: null, motivo: "sin_margen", margen_pct: m, gastos: g };
  }
  if (m < 0) {
    return { ventas_necesarias: null, motivo: "margen_negativo", margen_pct: m, gastos: g };
  }
  if (g <= 0) {
    // Sin gastos cargados el punto de equilibrio sería cero, que invita a
    // festejar algo que solo significa que falta cargar los gastos.
    return { ventas_necesarias: null, motivo: "sin_gastos", margen_pct: m, gastos: g };
  }
  return { ventas_necesarias: g / (m / 100), margen_pct: m, gastos: g };
}

export interface Avance {
  /** Qué porcentaje del objetivo se lleva vendido. */
  pct: number;
  /** Lo que falta facturar. 0 si ya se cubrió. */
  faltante: number;
  /** true si los gastos del mes ya están cubiertos. */
  cubierto: boolean;
  /**
   * Día del mes en que se cubren los gastos, al ritmo que se viene vendiendo.
   *
   * Si ya se cubrió, es el día en que pasó. Si al ritmo actual no se llega
   * dentro del mes, es `null`: estirar la proyección a "el día 47" no ayuda a
   * nadie.
   */
  dia_estimado: number | null;
  /** Lo que se vendió por día en promedio, hasta hoy. */
  ritmo_diario: number;
}

/**
 * Cómo viene el mes contra el objetivo.
 *
 * `vendidoNeto` es lo facturado sin IVA en lo que va del mes, y `dia` el día
 * de hoy (1..31). La proyección es lineal a propósito: suponer que el resto
 * del mes se vende al mismo ritmo es un supuesto que cualquiera entiende y
 * puede corregir de cabeza. Un modelo con estacionalidad daría un número más
 * difícil de discutir y no necesariamente mejor.
 */
export function avanceDelMes({
  objetivo, vendidoNeto, dia, diasDelMes,
}: {
  objetivo: number | null;
  vendidoNeto: unknown;
  dia: number;
  diasDelMes: number;
}): Avance | null {
  if (objetivo == null || objetivo <= 0) return null;
  const vendido = n(vendidoNeto);
  const d = Math.max(1, Math.min(diasDelMes, Math.floor(dia)));
  const ritmo = vendido / d;
  const pct = (vendido / objetivo) * 100;
  const cubierto = vendido >= objetivo;

  let diaEstimado: number | null = null;
  if (cubierto) {
    // Cuándo se cruzó, al ritmo promedio. Es una estimación: el sistema sabe
    // cuánto se vendió en total, no en qué orden.
    diaEstimado = ritmo > 0 ? Math.min(d, Math.max(1, Math.ceil(objetivo / ritmo))) : null;
  } else if (ritmo > 0) {
    const proyectado = Math.ceil(objetivo / ritmo);
    diaEstimado = proyectado <= diasDelMes ? proyectado : null;
  }

  return {
    pct,
    faltante: Math.max(0, objetivo - vendido),
    cubierto,
    dia_estimado: diaEstimado,
    ritmo_diario: ritmo,
  };
}

/** Días que tiene un mes. Sin zonas horarias: es aritmética de calendario. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** El mes anterior a uno dado. */
export function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}
