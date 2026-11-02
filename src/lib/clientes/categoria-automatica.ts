/**
 * La categoría que le toca a un cliente según lo que compró en el mes.
 *
 * Sin base de datos a propósito: de esto depende a qué precio se le vende a
 * 21.344 clientes, así que la cuenta tiene que poder probarse con casos
 * armados a mano.
 *
 * ── CÓMO SE DECIDE ────────────────────────────────────────────────────────
 * Cada categoría tiene un `monto_minimo_mensual`: lo que hay que comprar en el
 * mes para entrar. Le toca la categoría con el mínimo MÁS ALTO que el monto del
 * cliente alcanza.
 *
 *     OCASIONAL      0
 *     MINORISTA      5.000.000
 *     MAYORISTA     20.000.000
 *
 *     compró 7.000.000 → MINORISTA
 *     compró       0   → OCASIONAL
 *
 * ── LAS CATEGORÍAS SIN MÍNIMO NO PARTICIPAN ───────────────────────────────
 * `monto_minimo_mensual = null` significa "esta categoría se asigna a mano y el
 * sistema no la toca". Sirve para los acuerdos particulares: el cliente que
 * quedó como DISTRIBUIDOR por un trato no tiene que bajar de categoría porque
 * un mes compró poco.
 *
 * Por eso un cliente que HOY está en una categoría sin mínimo no se mueve: ver
 * `categoriaDeCliente`.
 *
 * ── CERO NO ES NULL ───────────────────────────────────────────────────────
 * Un mínimo de 0 es un valor real: la categoría de los que compran poco o nada,
 * el piso de la escalera. Es lo que hace que alguien que dejó de comprar BAJE
 * en vez de quedarse donde estaba.
 */

export interface CategoriaConMinimo {
  id: string;
  nombre: string;
  /** Compra mensual mínima. null = no participa del automático. */
  monto_minimo_mensual: number | null;
  activa?: boolean;
}

/** Las que participan, de la más alta a la más baja. */
export function escalera(categorias: CategoriaConMinimo[]): CategoriaConMinimo[] {
  return categorias
    .filter((c) => c.activa !== false)
    .filter((c) => c.monto_minimo_mensual != null && Number.isFinite(Number(c.monto_minimo_mensual)))
    .sort((a, b) => Number(b.monto_minimo_mensual) - Number(a.monto_minimo_mensual));
}

/**
 * La categoría que corresponde a ese monto mensual.
 *
 * Devuelve null cuando no hay ninguna categoría con mínimo cargado: sin
 * escalera no hay a dónde mover a nadie, y mover por las dudas sería cambiarle
 * el precio a todo el padrón.
 */
export function categoriaParaMonto(
  categorias: CategoriaConMinimo[],
  montoDelMes: number
): CategoriaConMinimo | null {
  const esc = escalera(categorias);
  if (esc.length === 0) return null;
  /**
   * Un mes puede dar NEGATIVO: si las devoluciones superaron a las ventas, el
   * neto queda en contra. Sin este piso en cero el cliente no alcanzaría ni el
   * escalón más bajo y se quedaría donde estaba, que es lo contrario de lo que
   * corresponde: un mes así es un mes en el que no compró nada.
   */
  const monto = Math.max(0, Number(montoDelMes) || 0);
  return esc.find((c) => monto >= Number(c.monto_minimo_mensual)) ?? null;
}

export interface DecisionCategoria {
  /** A qué categoría va. null = se queda donde está. */
  destino: CategoriaConMinimo | null;
  /** Si hay que escribir el cambio. */
  cambia: boolean;
  /** Por qué, en castellano, para el historial. */
  motivo: string;
}

/**
 * Qué hacer con un cliente concreto.
 *
 * ── LOS CASOS EN LOS QUE NO SE TOCA ───────────────────────────────────────
 *   - No hay escalera cargada (nadie puso mínimos todavía).
 *   - El cliente está en una categoría SIN mínimo: es una asignación a mano y
 *     el automático no la pisa.
 *   - Ya está en la categoría que le corresponde.
 *
 * El resto sí cambia, para arriba o para abajo. Que baje es la mitad del
 * sentido de esto: si solo subiera, en un año todos serían distribuidores.
 */
export function categoriaDeCliente(
  categorias: CategoriaConMinimo[],
  categoriaActualId: string | null,
  montoDelMes: number
): DecisionCategoria {
  const esc = escalera(categorias);
  if (esc.length === 0) {
    return { destino: null, cambia: false, motivo: "No hay montos mínimos cargados." };
  }

  const actual = categorias.find((c) => c.id === categoriaActualId) ?? null;
  if (actual && actual.monto_minimo_mensual == null) {
    return {
      destino: null,
      cambia: false,
      motivo: `${actual.nombre} se asigna a mano: el automático no la cambia.`,
    };
  }

  const destino = categoriaParaMonto(categorias, montoDelMes);
  if (!destino) {
    return { destino: null, cambia: false, motivo: "Ninguna categoría cubre ese monto." };
  }
  if (destino.id === categoriaActualId) {
    return { destino, cambia: false, motivo: `Sigue en ${destino.nombre}.` };
  }

  const subeOBaja =
    actual == null
      ? "Primera categoría asignada"
      : Number(destino.monto_minimo_mensual) > Number(actual.monto_minimo_mensual ?? 0)
        ? `Sube de ${actual.nombre} a ${destino.nombre}`
        : `Baja de ${actual.nombre} a ${destino.nombre}`;

  return {
    destino,
    cambia: true,
    motivo: `${subeOBaja} por comprar ${Math.round(Number(montoDelMes) || 0).toLocaleString("es-PY")} en el mes.`,
  };
}

/**
 * El período 'YYYY-MM' de una fecha, en hora de Paraguay.
 *
 * Paraguay es UTC−3 todo el año. Sin el corrimiento, una venta del 31 a las
 * 22:00 cae en el mes siguiente y el cliente la pierde en el mes que la hizo.
 */
export function periodoPy(fecha: Date | string = new Date()): string {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${py.getUTCFullYear()}-${String(py.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** El primer y el último día de un período 'YYYY-MM', como 'YYYY-MM-DD'. */
export function rangoDePeriodo(periodo: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  // Día 0 del mes siguiente = último día de este mes, y Date resuelve los años
  // bisiestos sin que haya que saberlos.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { desde: `${anio}-${p(mes)}-01`, hasta: `${anio}-${p(mes)}-${p(ultimo)}` };
}
