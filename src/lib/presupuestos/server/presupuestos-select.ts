/**
 * Columnas del presupuesto y lectura tolerante a bases sin el script 38.
 *
 * El script 38 agregó `nota_interna` y `falta_material`. Pedirlas en el SELECT
 * contra una base donde todavía no se corrió hace fallar la consulta entera, y
 * el listado queda en "No se pudieron cargar los presupuestos" — que es mucho
 * peor que no ver una nota interna. Mismo criterio que ya se usa con
 * `condiciones_comerciales` y el script 27.
 */

const COLS_COMUNES =
  "id, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_direccion, " +
  "numero_control, estado, moneda, subtotal, monto_iva, descuento_total, total, validez_dias, " +
  "fecha, fecha_vencimiento, forma_pago, plazo_entrega, observaciones, " +
  "convertido_pedido_id, convertido_venta_id, created_at, updated_at, usuario_nombre";

/** Nota interna y marca de falta de material (script 38). NO van al PDF. */
const COLS_38 = `${COLS_COMUNES}, nota_interna, falta_material`;

/** De quién es el presupuesto (script 41), que puede no ser quien lo cargó. */
export const PRESU_COLS = `${COLS_38}, vendedor_usuario_id, vendedor_nombre`;

/** Las mismas columnas sin las del script 38, por si no está corrido. */
export const PRESU_COLS_BASE = COLS_COMUNES;

/** ¿Falló porque la base todavía no tiene las columnas del script 41? */
export function faltaScript41(msg: string): boolean {
  return /vendedor_usuario_id|vendedor_nombre/.test(msg) && /does not exist|42703|schema cache/i.test(msg);
}

/** ¿Falló porque la base todavía no tiene las columnas del script 38? */
export function faltaScript38(msg: string): boolean {
  return /nota_interna|falta_material/.test(msg) && /does not exist|42703|schema cache/i.test(msg);
}

type QueryResult<T> = { data: T | null; error: { message: string } | null };

/**
 * Corre la consulta con las columnas del script 38 y, si la base no las tiene,
 * la repite sin ellas. `script38` dice cuál de las dos respondió, para que el
 * que llama complete los campos que faltan.
 */
export async function leerPresupuestosConFallback<T>(
  run: (cols: string) => PromiseLike<QueryResult<T>>
): Promise<QueryResult<T> & { script38: boolean }> {
  let full = await run(PRESU_COLS);
  // Sin el script 41 falta el vendedor: se reintenta con las columnas que sí
  // existen antes de dar por perdida la lectura entera.
  if (full.error && faltaScript41(full.error.message)) {
    console.warn("[presupuestos]", "script_41_no_aplicado", full.error.message);
    full = await run(COLS_38);
  }
  if (!full.error) return { ...full, script38: true };
  if (!faltaScript38(full.error.message)) return { ...full, script38: true };

  console.warn(
    "[presupuestos]",
    "script_38_no_aplicado",
    "se lee sin nota_interna/falta_material:",
    full.error.message
  );
  const base = await run(PRESU_COLS_BASE);
  return { ...base, script38: false };
}

/** Completa los campos del script 38 cuando la base todavía no los tiene. */
export function conCamposScript38<T extends Record<string, unknown>>(
  row: T,
  script38: boolean
): T & { nota_interna: string | null; falta_material: boolean } {
  if (script38) {
    return row as T & { nota_interna: string | null; falta_material: boolean };
  }
  return { ...row, nota_interna: null, falta_material: false };
}
