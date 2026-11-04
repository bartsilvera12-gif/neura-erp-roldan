/**
 * Qué gasto sirve para la SET y qué gasto no.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Crear reporte separado de gastos sin factura o no deducibles."
 *
 * ── POR QUÉ NO ES UN SÍ O UN NO ────────────────────────────────────────────
 *   Un gasto sin número de factura claramente no se puede usar. Pero el caso
 *   que duele es el otro: la factura ESTÁ cargada y tampoco sirve, porque le
 *   falta el timbrado o el RUC del proveedor. Ese gasto hoy se ve igual que
 *   uno bueno en la pantalla de Gastos, se contabiliza, y el problema aparece
 *   recién cuando el contador arma la declaración.
 *
 *   Por eso son tres clases y no dos:
 *
 *     deducible            tiene factura, timbrado y RUC
 *     factura_incompleta   tiene número, pero le falta algo
 *     sin_factura          no hay comprobante
 *
 *   Y de las dos últimas, `factura_incompleta` es la accionable: al proveedor
 *   todavía se le puede pedir el dato. Lo que se pagó sin factura ya está.
 *
 * ── LO QUE CUESTA ──────────────────────────────────────────────────────────
 *   No es solo que no se pueda descontar del IRE: es el IVA que se pagó y no
 *   se puede acreditar. Ese número va aparte porque es plata ya gastada.
 */

export interface GastoParaRevisar {
  id: string;
  fecha: string;
  categoria: string | null;
  descripcion: string | null;
  beneficiario: string | null;
  monto: number;
  monto_iva?: number | null;
  numero_factura?: string | null;
  nro_timbrado?: string | null;
  proveedor_ruc?: string | null;
}

export type ClaseGasto = "deducible" | "factura_incompleta" | "sin_factura";

export interface GastoClasificado extends GastoParaRevisar {
  clase: ClaseGasto;
  /** Qué le falta, en palabras, para mostrarlo tal cual en la pantalla. */
  faltan: string[];
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

const vacio = (v: unknown): boolean => v == null || String(v).trim() === "";

/**
 * Número de factura paraguayo: 001-001-0000001 (establecimiento, punto de
 * expedición, correlativo). Se acepta con o sin los guiones y con cualquier
 * cantidad de ceros, porque se carga a mano y nadie lo escribe igual; lo que
 * no se acepta es algo que no sean dígitos, que es "s/f", "varios" o un
 * nombre escrito en el campo equivocado.
 */
export function facturaBienFormada(numero: unknown): boolean {
  if (vacio(numero)) return false;
  const s = String(numero).trim();
  if (/^\d{1,3}-\d{1,3}-\d{1,7}$/.test(s)) return true;
  // Sin guiones: tiene que ser todo dígitos y no un par de números sueltos.
  return /^\d{7,15}$/.test(s);
}

/**
 * RUC paraguayo: número y dígito verificador, 80000000-0. Sin el verificador
 * no sirve para la declaración, así que un RUC sin guion cuenta como falta.
 */
export function rucBienFormado(ruc: unknown): boolean {
  if (vacio(ruc)) return false;
  return /^\d{3,9}-\d$/.test(String(ruc).trim());
}

/** El timbrado es un número de 8 dígitos; alcanza con que sean dígitos. */
export function timbradoBienFormado(t: unknown): boolean {
  if (vacio(t)) return false;
  return /^\d{4,12}$/.test(String(t).trim());
}

export function clasificarGasto(g: GastoParaRevisar): GastoClasificado {
  const faltan: string[] = [];

  if (vacio(g.numero_factura)) {
    return { ...g, clase: "sin_factura", faltan: ["factura"] };
  }
  // Un número que no es un número de factura es lo mismo que no tenerlo: el
  // "s/f" o el "varios" que alguien escribió ahí no es un comprobante.
  if (!facturaBienFormada(g.numero_factura)) {
    return { ...g, clase: "sin_factura", faltan: ["factura (el número cargado no es válido)"] };
  }

  if (!timbradoBienFormado(g.nro_timbrado)) faltan.push("timbrado");
  if (!rucBienFormado(g.proveedor_ruc)) faltan.push("RUC del proveedor");

  return {
    ...g,
    clase: faltan.length > 0 ? "factura_incompleta" : "deducible",
    faltan,
  };
}

export interface ResumenClase {
  clase: ClaseGasto;
  cantidad: number;
  monto: number;
  /** IVA que se pagó y no se puede acreditar. */
  iva: number;
}

export interface ResumenNoDeducibles {
  /** Una entrada por clase, siempre las tres, aunque alguna esté en cero. */
  por_clase: ResumenClase[];
  /** Por categoría, solo lo que NO es deducible, de mayor a menor. */
  por_categoria: { categoria: string; cantidad: number; monto: number }[];
  total_gastos: number;
  monto_total: number;
  /** Lo que no sirve: sin_factura + factura_incompleta. */
  no_deducibles: number;
  monto_no_deducible: number;
  iva_no_acreditable: number;
  /** Qué porcentaje del gasto del período no sirve. */
  porcentaje_no_deducible: number | null;
}

const SIN_CATEGORIA = "Sin categoría";

export function resumirNoDeducibles(gastos: GastoClasificado[]): ResumenNoDeducibles {
  const clases: ClaseGasto[] = ["sin_factura", "factura_incompleta", "deducible"];
  const por_clase = clases.map((clase) => {
    const del = gastos.filter((g) => g.clase === clase);
    return {
      clase,
      cantidad: del.length,
      monto: del.reduce((a, g) => a + n(g.monto), 0),
      iva: del.reduce((a, g) => a + n(g.monto_iva), 0),
    };
  });

  const malos = gastos.filter((g) => g.clase !== "deducible");

  const porCat = new Map<string, { cantidad: number; monto: number }>();
  for (const g of malos) {
    const k = (g.categoria ?? "").trim() || SIN_CATEGORIA;
    const acc = porCat.get(k) ?? { cantidad: 0, monto: 0 };
    acc.cantidad += 1;
    acc.monto += n(g.monto);
    porCat.set(k, acc);
  }

  const monto_total = gastos.reduce((a, g) => a + n(g.monto), 0);
  const monto_no_deducible = malos.reduce((a, g) => a + n(g.monto), 0);

  return {
    por_clase,
    por_categoria: [...porCat.entries()]
      .map(([categoria, v]) => ({ categoria, ...v }))
      .sort((a, b) => b.monto - a.monto),
    total_gastos: gastos.length,
    monto_total,
    no_deducibles: malos.length,
    monto_no_deducible,
    iva_no_acreditable: malos.reduce((a, g) => a + n(g.monto_iva), 0),
    // Sin gastos no es 0%: es que no hay con qué calcularlo. Un 0% diría que
    // está todo en orden.
    porcentaje_no_deducible: monto_total > 0 ? (monto_no_deducible / monto_total) * 100 : null,
  };
}

/** Lo que se le puede ir a pedir al proveedor todavía. */
export function reclamables(gastos: GastoClasificado[]): GastoClasificado[] {
  return gastos
    .filter((g) => g.clase === "factura_incompleta")
    .sort((a, b) => n(b.monto) - n(a.monto));
}

export const SIN_CATEGORIA_LABEL = SIN_CATEGORIA;
