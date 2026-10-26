/**
 * Valoración de existencias a una fecha (punto 1.6).
 *
 * EL PROBLEMA
 *   `productos.stock_actual` y `productos.costo_promedio` dicen cómo están las
 *   cosas HOY. El punto pide el inventario y su valor a una fecha elegida, que
 *   puede ser el cierre del año pasado. Esos dos números no sirven para eso.
 *
 * LA RECONSTRUCCIÓN
 *   Se vuelven a pasar los movimientos en orden cronológico hasta la fecha
 *   pedida, llevando el stock y el costo promedio ponderado como los llevaría
 *   el sistema en vivo:
 *
 *     ENTRADA con costo  → CPP = (stock·costo + cantidad·costoEntrada) / (stock+cantidad)
 *     SALIDA             → baja el stock, el costo NO cambia
 *     AJUSTE             → por su signo; si suma y trae costo, recalcula CPP
 *
 * EL AJUSTE NO SIEMPRE SUMA O RESTA: A VECES FIJA
 *   Un ajuste hecho desde la ficha del producto escribe el stock que uno
 *   tipea, pisando lo que hubiera. Quedó registrado así:
 *
 *     ENTRADA compra ×6   (acumulan 162)
 *     AJUSTE 200          "Ajuste manual desde la ficha del producto (0 → 200)"
 *
 *   Sumarle 200 a 162 da 362, y el sistema tiene 190. Ese ajuste no sumó
 *   doscientos: DEJÓ el stock en doscientos. Por eso, cuando el movimiento
 *   trae `stock_despues`, ese número manda y el acumulado se sincroniza con
 *   él en vez de sumarle el delta.
 *
 *   Tiene un beneficio extra: cada ajuste con stock final se vuelve un punto
 *   de control. Si un movimiento viejo quedó mal cargado, el error no se
 *   arrastra para siempre — se corta en el primer ajuste posterior.
 *
 *   Reconstruir en vez de guardar una foto por día tiene una ventaja concreta:
 *   si mañana se corrige un movimiento viejo, la valoración de esa fecha se
 *   corrige sola. Una foto quedaría mintiendo para siempre.
 *
 * POR QUÉ EL COSTO TAMBIÉN SE RECONSTRUYE Y NO SE USA EL DE HOY
 *   Valuar el stock de diciembre con el costo de hoy mezcla dos momentos: da
 *   un número que no es ni el de diciembre ni el de hoy. Con cotizaciones del
 *   dólar que se mueven, la diferencia no es chica.
 *
 * LAS ANULACIONES DESHACEN, NO SOLO DESCUENTAN
 *   Una compra anulada genera una SALIDA por la misma cantidad. Tratarla como
 *   una salida común bajaría el stock pero dejaría el costo promedio con el
 *   efecto de una compra que nunca existió. Caso real:
 *
 *     inventario inicial  5 a 300.000   → CPP 300.000
 *     compra             10 a 320.000   → CPP 313.333
 *     anulación de esa compra           → tiene que volver a 300.000
 *
 *   Por eso la anulación de compra revierte el promedio con la cuenta inversa,
 *   que devuelve exactamente el costo anterior.
 *
 *   La anulación de una venta es al revés: la mercadería vuelve tal como
 *   salió, así que repone stock y NO toca el costo.
 *
 * EL LÍMITE HONESTO
 *   La reconstrucción solo puede ser tan buena como los movimientos. Un ajuste
 *   viejo sin signo (ver punto 1.4) no se puede aplicar: se cuenta aparte y se
 *   informa, para que nadie tome por exacto un número que no lo es.
 */

export type TipoMov = "ENTRADA" | "SALIDA" | "AJUSTE";

export interface MovimientoReplay {
  producto_id: string;
  fecha: string;
  tipo: TipoMov | string;
  cantidad: number;
  /** compra, venta, ajuste_manual, anulacion_compra, anulacion_venta, … */
  origen: string | null;
  /** Con signo, si la base lo tiene (script 19). */
  cantidad_delta: number | null;
  /**
   * Stock que quedó DESPUÉS del movimiento, si la base lo tiene (script 19).
   * Cuando está, manda sobre el delta: un ajuste desde la ficha del producto
   * fija el stock, no lo suma.
   */
  stock_despues: number | null;
  costo_unitario: number;
}

export interface EstadoProducto {
  stock: number;
  costo: number;
  /** Movimientos que no se pudieron aplicar por no saber si sumaban o restaban. */
  indeterminados: number;
  /** Veces que un ajuste con stock final resincronizó el acumulado. */
  resincronizaciones: number;
}

/** Delta con signo de un movimiento. `null` = no se puede saber. */
export function deltaDe(m: MovimientoReplay): number | null {
  if (m.cantidad_delta != null && Number.isFinite(m.cantidad_delta)) {
    return Number(m.cantidad_delta);
  }
  const abs = Math.abs(Number(m.cantidad) || 0);
  if (m.tipo === "ENTRADA") return abs;
  if (m.tipo === "SALIDA") return -abs;
  // AJUSTE sin delta: el sistema viejo guardaba solo el valor absoluto.
  // Adivinar el signo acá daría una valoración con pinta de exacta y mal.
  return null;
}

/**
 * Replay de los movimientos de UN producto, en orden cronológico.
 * Los movimientos tienen que venir ya filtrados por fecha y ordenados.
 */
export function reconstruirProducto(movs: MovimientoReplay[]): EstadoProducto {
  let stock = 0;
  let costo = 0;
  let indeterminados = 0;
  let resincronizaciones = 0;

  for (const m of movs) {
    const costoMov = Number(m.costo_unitario) || 0;
    const origen = String(m.origen ?? "");
    const fijado =
      m.stock_despues != null && Number.isFinite(Number(m.stock_despues))
        ? Number(m.stock_despues)
        : null;
    const delta = deltaDe(m);

    // ── Anulación de compra: deshace el promedio que esa compra formó ──────
    if (origen === "anulacion_compra") {
      const cant = Math.abs(Number(m.cantidad) || 0);
      const queda = stock - cant;
      if (queda > 0 && costoMov > 0) {
        const previo = (stock * costo - cant * costoMov) / queda;
        // Un costo negativo significa que faltan movimientos antes de este;
        // dejarlo pasar valuaría el stock en negativo.
        costo = previo > 0 ? previo : costo;
      } else if (queda <= 0) {
        costo = 0;
      }
      stock = queda > 0 ? queda : 0;
      continue;
    }

    // ── Anulación de venta: la mercadería vuelve como salió ───────────────
    if (origen === "anulacion_venta") {
      stock += Math.abs(Number(m.cantidad) || 0);
      continue;
    }

    const entraron =
      delta != null && delta > 0
        ? delta
        : fijado != null && fijado > stock
          ? fijado - stock
          : 0;

    if (entraron > 0 && costoMov > 0) {
      if (origen === "ajuste_manual") {
        // Un ajuste que suma unidades NO promedia: esas unidades aparecieron
        // en un conteo, no se compraron, y no hay precio real que mezclar.
        // Es además lo que hace el sistema en vivo.
        //
        // La excepción es el producto que todavía no tiene costo: ahí el del
        // ajuste es el único dato que existe, y descartarlo dejaría la
        // mercadería valuada en cero.
        if (costo <= 0) costo = costoMov;
      } else {
        // Entrada comprada: recalcula el promedio ponderado. Sin costo
        // informado no se toca el costo — mezclarlo con un cero bajaría el
        // promedio como si la mercadería hubiera entrado gratis.
        const total = stock + entraron;
        costo = total > 0 ? (stock * costo + entraron * costoMov) / total : costoMov;
      }
    }

    if (fijado != null) {
      // El movimiento dice con cuánto quedó: ese número manda.
      stock = fijado;
      resincronizaciones++;
      continue;
    }
    if (delta == null) { indeterminados++; continue; }
    // Una salida no cambia el costo promedio: sacar mercadería no cambia lo
    // que costó la que queda.
    stock += delta;
  }

  // El stock no puede ser negativo. Si la reconstrucción da negativo es que
  // faltan movimientos, no que haya deuda de mercadería.
  if (stock < 0) stock = 0;
  return { stock, costo, indeterminados, resincronizaciones };
}

/**
 * Replay de todos los productos de una vez.
 * `movs` tiene que venir ordenado por producto_id y después por fecha.
 */
export function reconstruirTodos(
  movs: MovimientoReplay[]
): Map<string, EstadoProducto> {
  const porProducto = new Map<string, MovimientoReplay[]>();
  for (const m of movs) {
    const id = String(m.producto_id);
    const lista = porProducto.get(id);
    if (lista) lista.push(m);
    else porProducto.set(id, [m]);
  }
  const out = new Map<string, EstadoProducto>();
  for (const [id, lista] of porProducto) {
    out.set(id, reconstruirProducto(lista));
  }
  return out;
}
