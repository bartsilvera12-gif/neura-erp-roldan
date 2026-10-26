import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Stock mínimo automático a partir de las ventas (punto 1.2 del pedido).
 *
 * QUÉ CALCULA
 *   Para cada producto, la MEDIANA de lo que se vendió por mes en los últimos
 *   seis meses cerrados. Esa mediana es el mínimo sugerido: la cantidad que
 *   cubre un mes normal de ventas.
 *
 * POR QUÉ LA MEDIANA Y NO EL PROMEDIO
 *   Una venta grande de una sola vez — una obra, un cliente mayorista que
 *   apareció una vez — arrastra el promedio hacia arriba y deja un mínimo que
 *   obliga a tener plata parada en mercadería que no rota. La mediana es el
 *   mes del medio: un pico extraordinario mueve el orden, no el valor. Por eso
 *   el pedido dice "una medida robusta como la mediana".
 *
 *   Se devuelve también el pico del período, para que se vea de dónde salió la
 *   diferencia cuando la mediana parece baja.
 *
 * DOS DECISIONES QUE CAMBIAN EL NÚMERO
 *
 *   1. El mes en curso NO cuenta. Está incompleto por definición, y meterlo
 *      arrastra la mediana hacia abajo todos los meses. Se usan los seis meses
 *      cerrados anteriores.
 *
 *   2. Los meses SIN ventas cuentan como cero. Un producto que vendió 100
 *      unidades en dos meses y nada en los otros cuatro tiene mediana 0, no
 *      100: no es un producto de stock permanente, es uno que se mueve de a
 *      ratos. Calcular la mediana solo sobre los meses con venta daría un
 *      mínimo alto para algo que la mayor parte del año no se vende.
 *
 * Las ventas anuladas no cuentan.
 */

const MESES_VENTANA = 6;

/** Paraguay es UTC−3 todo el año. Los servidores tienen tzdata vieja, así que
 *  el corrimiento va escrito y no se lee de la zona horaria del sistema. */
const TZ_PY = "interval '3 hours'";

export interface MinimoSugerido {
  producto_id: string;
  /** Mediana de unidades vendidas por mes. Es el mínimo sugerido. */
  mediana: number;
  /** Unidades vendidas en toda la ventana. */
  total: number;
  /** El mejor mes. Sirve para explicar una mediana que parece baja. */
  pico: number;
  /** Cuántos de los meses de la ventana tuvieron al menos una venta. */
  meses_con_venta: number;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * Mínimo sugerido por producto. Devuelve solo los productos que tuvieron al
 * menos una venta en la ventana: de los demás no hay con qué estimar.
 */
export async function calcularMinimosSugeridos(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  meses: number = MESES_VENTANA
): Promise<Map<string, MinimoSugerido>> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  // `ventas_items` no tiene sucursal_id: la sucursal vive en la venta.
  const SUC_V = andSucursal(sucursalId, "v.");
  const n = Math.max(2, Math.min(24, Math.trunc(meses)));

  const sql = `
    WITH hoy AS (
      SELECT date_trunc('month', (now() - ${TZ_PY}))::date AS mes_actual
    ),
    ventana AS (
      SELECT (mes_actual - ($2::int || ' months')::interval)::date AS desde,
             mes_actual::date AS hasta
        FROM hoy
    ),
    meses AS (
      SELECT generate_series(v.desde, (v.hasta - interval '1 month')::date, interval '1 month')::date AS mes
        FROM ventana v
    ),
    vendido AS (
      SELECT vi.producto_id,
             date_trunc('month', (v.fecha - ${TZ_PY}))::date AS mes,
             SUM(vi.cantidad)::numeric AS unidades
        FROM ${tVI} vi
        JOIN ${tV} v ON v.id = vi.venta_id AND v.empresa_id = $1::uuid
       WHERE vi.empresa_id = $1::uuid${SUC_V}
         AND COALESCE(v.estado,'completada') <> 'anulada'
         AND v.fecha >= (SELECT desde FROM ventana)
         AND v.fecha <  (SELECT hasta FROM ventana)
       GROUP BY 1, 2
    ),
    productos AS (SELECT DISTINCT producto_id FROM vendido),
    -- Cada producto contra TODOS los meses de la ventana: los meses sin venta
    -- entran como 0. Sin esto la mediana se calcularía solo sobre los meses
    -- buenos y daría un mínimo alto para algo que rota de a ratos.
    grilla AS (
      SELECT p.producto_id, m.mes, COALESCE(x.unidades, 0) AS unidades
        FROM productos p
        CROSS JOIN meses m
        LEFT JOIN vendido x ON x.producto_id = p.producto_id AND x.mes = m.mes
    )
    SELECT producto_id::text AS producto_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY unidades)::float8 AS mediana,
           SUM(unidades)::float8 AS total,
           MAX(unidades)::float8 AS pico,
           COUNT(*) FILTER (WHERE unidades > 0)::int AS meses_con_venta
      FROM grilla
     GROUP BY producto_id`;

  const r = await pool().query<MinimoSugerido>(sql, [empresaId, n]);
  const out = new Map<string, MinimoSugerido>();
  for (const f of r.rows) {
    out.set(String(f.producto_id), {
      producto_id: String(f.producto_id),
      mediana: Number(f.mediana) || 0,
      total: Number(f.total) || 0,
      pico: Number(f.pico) || 0,
      meses_con_venta: Number(f.meses_con_venta) || 0,
    });
  }
  return out;
}

/**
 * Igual que la anterior pero nunca lanza: si el pool directo no está
 * disponible devuelve un mapa vacío.
 *
 * Reposición tiene que seguir abriendo aunque esto falle. El mínimo sugerido
 * es información extra; el resto de la pantalla no depende de él.
 */
export async function minimosSugeridosOVacio(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  meses?: number
): Promise<Map<string, MinimoSugerido>> {
  try {
    return await calcularMinimosSugeridos(schemaRaw, empresaId, sucursalId, meses);
  } catch (err) {
    console.error("[stock-minimo-pg]", err instanceof Error ? err.message : err);
    return new Map();
  }
}

export { MESES_VENTANA };
