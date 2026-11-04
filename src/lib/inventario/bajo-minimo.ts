/**
 * Qué hay que reponer: los artículos por debajo de su mínimo, por rubro.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Poner una lista por rubro de los productos que tienen bajo stock para la
 *   orden de compra, todos los que estén por debajo del mínimo."
 *
 * ── EN QUÉ SE DIFERENCIA DE SUGERENCIAS DE REPOSICIÓN ──────────────────────
 *   Sugerencias mira el CONSUMO: cuánto salió por día y para cuántos días
 *   alcanza lo que queda. Contesta "¿cuánto conviene comprar?".
 *
 *   Esta lista mira el MÍNIMO cargado en la ficha y nada más. Contesta
 *   "¿qué bajó de donde dijimos que no debía bajar?". Es una pregunta más
 *   simple y más dura: no opina, compara dos números.
 *
 *   Las dos sirven y no se reemplazan. Un artículo que no se vende hace meses
 *   no aparece en Sugerencias —no tiene consumo— pero sí acá si alguien
 *   decidió que siempre tiene que haber tres en el depósito.
 *
 * ── EL CERO NO ES UN MÍNIMO ────────────────────────────────────────────────
 *   `stock_minimo = 0` quiere decir "nadie cargó el mínimo", no "el mínimo es
 *   cero". Esos artículos quedan FUERA de la lista: de ellos no se puede
 *   afirmar que falten. Y se cuentan aparte, porque es el dato que dice hasta
 *   dónde llega la lista — hoy cubre 626 de 1.002 artículos.
 */

export interface ArticuloBajoMinimo {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  stock_actual: number;
  stock_minimo: number;
  costo_promedio: number;
  rubro_id: string | null;
  rubro_nombre: string;
}

/** `sin_stock` es peor que `bajo`: no es que esté por caer, es que ya no hay. */
export type Severidad = "sin_stock" | "bajo";

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/** Rubro al que se mandan los artículos que no tienen ninguno. Va último. */
export const SIN_RUBRO = "(sin rubro)";

/**
 * ¿Entra en la lista?
 *
 * Hace falta un mínimo CARGADO —mayor a cero— y que el stock esté por debajo.
 * Un stock negativo (pasa: se vendió más de lo que el sistema creía tener)
 * cuenta como por debajo, que es lo correcto.
 */
export function estaBajoMinimo(a: { stock_actual: unknown; stock_minimo: unknown }): boolean {
  const min = n(a.stock_minimo);
  return min > 0 && n(a.stock_actual) < min;
}

/** Cuántas unidades faltan para llegar al mínimo. Nunca negativo. */
export function faltante(a: { stock_actual: unknown; stock_minimo: unknown }): number {
  return Math.max(0, n(a.stock_minimo) - n(a.stock_actual));
}

export function severidad(a: { stock_actual: unknown }): Severidad {
  return n(a.stock_actual) <= 0 ? "sin_stock" : "bajo";
}

/** Lo que cuesta reponer ese artículo hasta el mínimo, al costo promedio. */
export function valorFaltante(a: ArticuloBajoMinimo): number {
  return faltante(a) * n(a.costo_promedio);
}

/**
 * Qué porcentaje del mínimo hay hoy. Sirve para ordenar por gravedad.
 *
 * Un artículo con 1 de 100 está peor que uno con 95 de 100, aunque los dos
 * estén "bajo mínimo" y al segundo le falte más en unidades absolutas.
 */
export function cobertura(a: { stock_actual: unknown; stock_minimo: unknown }): number {
  const min = n(a.stock_minimo);
  if (min <= 0) return 1;
  return Math.max(0, n(a.stock_actual)) / min;
}

export interface GrupoRubro {
  rubro_id: string | null;
  rubro_nombre: string;
  articulos: ArticuloBajoMinimo[];
  /** Cuántos artículos del rubro están bajo mínimo. */
  cantidad: number;
  /** De esos, cuántos están en cero. */
  sin_stock: number;
  /** Unidades que faltan en todo el rubro. */
  faltante_total: number;
  /** Lo que cuesta reponerlo, al costo promedio. */
  valor_total: number;
}

/**
 * Agrupa por rubro y ordena.
 *
 * DENTRO DEL RUBRO: primero lo que está en cero, después lo más cerca de cero
 * en proporción a su mínimo, y a igualdad, por nombre. Quien arma la orden de
 * compra lee de arriba hacia abajo y corta cuando se le acaba el presupuesto:
 * lo urgente tiene que estar arriba.
 *
 * ENTRE RUBROS: por nombre, que es como está organizado el depósito y como la
 * gente los busca. `(sin rubro)` va al final: es una anomalía de carga, no una
 * categoría.
 */
export function agruparPorRubro(articulos: ArticuloBajoMinimo[]): GrupoRubro[] {
  const mapa = new Map<string, GrupoRubro>();

  for (const a of articulos) {
    const nombre = a.rubro_nombre?.trim() || SIN_RUBRO;
    const clave = a.rubro_id ?? SIN_RUBRO;
    let g = mapa.get(clave);
    if (!g) {
      g = {
        rubro_id: a.rubro_id ?? null,
        rubro_nombre: nombre,
        articulos: [],
        cantidad: 0,
        sin_stock: 0,
        faltante_total: 0,
        valor_total: 0,
      };
      mapa.set(clave, g);
    }
    g.articulos.push(a);
    g.cantidad += 1;
    if (severidad(a) === "sin_stock") g.sin_stock += 1;
    g.faltante_total += faltante(a);
    g.valor_total += valorFaltante(a);
  }

  for (const g of mapa.values()) {
    g.articulos.sort((x, y) => {
      const sx = severidad(x) === "sin_stock" ? 0 : 1;
      const sy = severidad(y) === "sin_stock" ? 0 : 1;
      if (sx !== sy) return sx - sy;
      const cx = cobertura(x), cy = cobertura(y);
      if (cx !== cy) return cx - cy;
      return x.nombre.localeCompare(y.nombre, "es");
    });
  }

  return [...mapa.values()].sort((a, b) => {
    const aSin = a.rubro_nombre === SIN_RUBRO;
    const bSin = b.rubro_nombre === SIN_RUBRO;
    if (aSin !== bSin) return aSin ? 1 : -1;
    return a.rubro_nombre.localeCompare(b.rubro_nombre, "es");
  });
}

export interface ResumenBajoMinimo {
  rubros: number;
  articulos: number;
  sin_stock: number;
  faltante_total: number;
  valor_total: number;
}

export function resumirGrupos(grupos: GrupoRubro[]): ResumenBajoMinimo {
  return {
    rubros: grupos.length,
    articulos: grupos.reduce((s, g) => s + g.cantidad, 0),
    sin_stock: grupos.reduce((s, g) => s + g.sin_stock, 0),
    faltante_total: grupos.reduce((s, g) => s + g.faltante_total, 0),
    valor_total: grupos.reduce((s, g) => s + g.valor_total, 0),
  };
}

/**
 * Las líneas para la orden de compra, en el formato que espera
 * `/api/ordenes-compra`.
 *
 * La cantidad es lo que falta para llegar al mínimo, no un redondeo: quien
 * arme la orden puede subirla, pero el número de partida es el que el sistema
 * puede justificar.
 */
export function lineasParaOrden(articulos: ArticuloBajoMinimo[]): Array<{
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
}> {
  return articulos.map((a) => ({
    descripcion: a.sku ? `${a.nombre} (${a.sku})` : a.nombre,
    cantidad: faltante(a),
    unidad: a.unidad?.trim() || "UNIDAD",
    precio_unitario: n(a.costo_promedio),
  }));
}
