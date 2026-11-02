/**
 * Precios y stock de UN depósito.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────
 *   El precio del producto es el de la sucursal. Un depósito puede tener su
 *   propia excepción en `producto_precios_deposito`, y cuando la tiene, esa
 *   manda — pero solo en las columnas que estén cargadas: `NULL` significa
 *   "usá el del producto", no "cero".
 *
 * ── POR QUÉ SE RESUELVE ACÁ Y NO EN CADA PANTALLA ─────────────────────────
 *   Caja calcula los niveles B (+5%) y C (+10%) sobre el precio de lista, y
 *   los márgenes sobre el costo. Si el precio del depósito se aplicara en la
 *   pantalla, habría que acordarse de aplicarlo en los cinco lugares que lo
 *   usan y, el día que se agregue un sexto, ese quedaría cobrando el precio
 *   de la sucursal sin que nadie lo note.
 *
 *   Pisando los campos del producto en la respuesta de /api/productos, todo
 *   lo que ya funciona sigue funcionando: para la pantalla, el producto
 *   simplemente vale eso en ese depósito.
 *
 * ── SI EL SCRIPT 51 NO ESTÁ CORRIDO ──────────────────────────────────────
 *   No hay excepciones que aplicar y el sistema se comporta igual que antes.
 *   Devuelve un mapa vacío en vez de fallar: el inventario no puede quedarse
 *   sin productos por una función que todavía no se usa.
 */

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- igual que el
   resto de las capas que hablan con PostgREST sobre un schema de tenant. */
export type PreciosSupabase = any;

/** Lo que un depósito dice de un producto. `null` = lo del producto. */
export interface PrecioDeposito {
  precio_venta: number | null;
  precio_usd: number | null;
  markup_pct: number | null;
}

const FALTA_TABLA =
  /producto_precios_deposito/i;

function esTablaOColumnaFaltante(msg: string | null | undefined): boolean {
  const m = msg ?? "";
  return FALTA_TABLA.test(m) && /does not exist|schema cache|PGRST205|42P01|42703/i.test(m);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excepciones de precio de un depósito, por producto.
 *
 * Se pide de una sola vez para todo el depósito y no producto por producto:
 * el catálogo entra en una consulta y Caja no puede hacer 300 viajes para
 * mostrar una lista.
 */
export async function preciosDeDeposito(
  sb: PreciosSupabase,
  empresaId: string,
  ubicacionId: string
): Promise<{ mapa: Map<string, PrecioDeposito>; disponible: boolean }> {
  const vacio = { mapa: new Map<string, PrecioDeposito>(), disponible: false };
  if (!ubicacionId) return vacio;

  const r = await sb
    .from("producto_precios_deposito")
    .select("producto_id, precio_venta, precio_usd, markup_pct")
    .eq("empresa_id", empresaId)
    .eq("ubicacion_id", ubicacionId);

  if (r.error) {
    if (esTablaOColumnaFaltante(r.error.message)) return vacio;
    throw new Error(r.error.message);
  }

  const mapa = new Map<string, PrecioDeposito>();
  for (const row of (r.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.producto_id ?? "");
    if (!id) continue;
    mapa.set(id, {
      precio_venta: numOrNull(row.precio_venta),
      precio_usd: numOrNull(row.precio_usd),
      markup_pct: numOrNull(row.markup_pct),
    });
  }
  return { mapa, disponible: true };
}

/**
 * Stock de un depósito, por producto.
 *
 * Ojo con el default: un producto SIN fila en `inventario_stock_ubicacion`
 * no es un producto con cero en ese depósito necesariamente — puede no estar
 * desglosado todavía (alta con stock inicial sin elegir depósito). Por eso se
 * devuelve el mapa y quien lo usa decide: para VENDER conviene tratar la
 * ausencia como "no desglosado" y dejar que el guard del stock global haga su
 * trabajo, en vez de bloquear una venta de mercadería que sí está.
 */
export async function stockDeDeposito(
  sb: PreciosSupabase,
  empresaId: string,
  ubicacionId: string
): Promise<{ mapa: Map<string, number>; disponible: boolean }> {
  const vacio = { mapa: new Map<string, number>(), disponible: false };
  if (!ubicacionId) return vacio;

  const r = await sb
    .from("inventario_stock_ubicacion")
    .select("producto_id, stock_actual")
    .eq("empresa_id", empresaId)
    .eq("ubicacion_id", ubicacionId);

  if (r.error) {
    if (/inventario_stock_ubicacion/.test(r.error.message ?? "")) return vacio;
    throw new Error(r.error.message);
  }

  const mapa = new Map<string, number>();
  for (const row of (r.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.producto_id ?? "");
    if (!id) continue;
    mapa.set(id, Number(row.stock_actual) || 0);
  }
  return { mapa, disponible: true };
}

/**
 * Pisa el precio y el stock de una fila de producto con los del depósito.
 *
 * Devuelve una fila nueva; no muta la original. Agrega tres campos para que
 * la pantalla pueda decir de dónde salió cada número en vez de mostrar un
 * precio distinto sin explicación:
 *   · `precio_de_deposito`  — true si el precio lo puso el depósito.
 *   · `stock_en_deposito`   — el stock de ESE depósito (null si no hay fila).
 *   · `stock_global`        — el total del producto, para poder compararlos.
 */
export function aplicarDeposito(
  fila: Record<string, unknown>,
  precio: PrecioDeposito | undefined,
  stock: number | undefined
): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...fila };
  const stockGlobal = Number(fila.stock_actual) || 0;

  let vinoDelDeposito = false;
  if (precio) {
    if (precio.precio_venta != null) {
      salida.precio_venta = precio.precio_venta;
      vinoDelDeposito = true;
    }
    if (precio.precio_usd != null) {
      salida.precio_usd = precio.precio_usd;
      vinoDelDeposito = true;
    }
    if (precio.markup_pct != null) {
      salida.markup_pct = precio.markup_pct;
      vinoDelDeposito = true;
    }
  }

  salida.precio_de_deposito = vinoDelDeposito;
  salida.stock_global = stockGlobal;
  salida.stock_en_deposito = stock === undefined ? null : stock;
  // El stock que la pantalla usa para decidir si se puede vender pasa a ser el
  // del depósito. Cuando el producto no está desglosado se deja el global:
  // mostrar 0 ahí haría que Caja se niegue a vender mercadería que está.
  if (stock !== undefined) salida.stock_actual = stock;

  return salida;
}
