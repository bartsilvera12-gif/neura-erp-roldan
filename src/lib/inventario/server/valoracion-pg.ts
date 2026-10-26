import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { reconstruirTodos, type MovimientoReplay } from "./valoracion";

/**
 * Valoración de existencias a una fecha (punto 1.6) — acceso a datos.
 *
 * La cuenta vive en `valoracion.ts`, sin base de datos, para poder probarla
 * con casos armados a mano. Acá solo se traen los movimientos y se arma la
 * respuesta.
 */

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const TZ_PY = "-03:00";

/**
 * Tope de movimientos a traer. Con más que esto la reconstrucción en memoria
 * deja de ser razonable y conviene avisar en vez de tardar un minuto o quedarse
 * sin memoria en silencio.
 */
const MAX_MOVIMIENTOS = 200_000;

export interface FilaValoracion {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  rubro_id: string | null;
  rubro_nombre: string | null;
  cantidad: number;
  costo_unitario: number;
  valor_total: number;
  /** Stock de hoy, para ver cuánto se movió desde la fecha consultada. */
  stock_hoy: number;
  indeterminados: number;
}

export interface ResultadoValoracion {
  /** Corte efectivamente aplicado, en ISO. */
  corte: string;
  filas: FilaValoracion[];
  total_articulos: number;
  total_unidades: number;
  valor_total: number;
  /** Movimientos que no se pudieron aplicar por no saber el signo. */
  indeterminados: number;
  /** true si se llegó al tope y el resultado está incompleto. */
  truncado: boolean;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * Inventario y valor del stock a una fecha.
 *
 * @param fecha  YYYY-MM-DD en hora de Paraguay. El día entra COMPLETO: pedir
 *               el 31/12 incluye todo lo que pasó ese 31, que es lo que
 *               cualquiera espera de un cierre de año.
 * @param rubroId  Limita a un rubro. Vacío = general.
 */
export async function valorizarAFecha(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  fecha: string,
  rubroId?: string | null
): Promise<ResultadoValoracion> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const SUC_M = andSucursal(sucursalId, "m.");
  const SUC_P = andSucursal(sucursalId, "p.");
  const p = pool();

  const corte = `${fecha}T23:59:59.999${TZ_PY}`;

  // `cantidad_delta` llega con el script 19. Sin él, el signo se deduce del
  // tipo y los ajustes viejos quedan indeterminados (lo informa la pantalla).
  const tieneDelta = await p.query<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'movimientos_inventario'
          AND column_name = 'cantidad_delta'
     ) AS existe`,
    [schema]
  );
  const colDelta = tieneDelta.rows[0]?.existe ? "m.cantidad_delta" : "NULL::numeric";
  const colStock = tieneDelta.rows[0]?.existe ? "m.stock_despues" : "NULL::numeric";

  const movQ = await p.query<{
    producto_id: string; fecha: string; tipo: string; origen: string | null;
    cantidad: string; cantidad_delta: string | null;
    stock_despues: string | null; costo_unitario: string;
  }>(
    `SELECT m.producto_id::text AS producto_id,
            m.fecha,
            m.tipo,
            m.origen,
            m.cantidad,
            ${colDelta} AS cantidad_delta,
            ${colStock} AS stock_despues,
            m.costo_unitario
       FROM ${tM} m
      WHERE m.empresa_id = $1::uuid${SUC_M}
        AND m.fecha <= $2::timestamptz
        AND m.producto_id IS NOT NULL
      ORDER BY m.producto_id, m.fecha, m.created_at
      LIMIT ${MAX_MOVIMIENTOS + 1}`,
    [empresaId, corte]
  );

  const truncado = movQ.rows.length > MAX_MOVIMIENTOS;
  const movs: MovimientoReplay[] = movQ.rows.slice(0, MAX_MOVIMIENTOS).map((r) => ({
    producto_id: r.producto_id,
    fecha: String(r.fecha),
    tipo: r.tipo,
    origen: r.origen,
    cantidad: Number(r.cantidad) || 0,
    cantidad_delta: r.cantidad_delta == null ? null : Number(r.cantidad_delta),
    stock_despues: r.stock_despues == null ? null : Number(r.stock_despues),
    costo_unitario: Number(r.costo_unitario) || 0,
  }));

  const estados = reconstruirTodos(movs);

  // Ficha de los productos, para nombre, rubro y el stock de hoy.
  const args: unknown[] = [empresaId];
  let filtroRubro = "";
  if (rubroId) {
    args.push(rubroId);
    filtroRubro = ` AND p.categoria_principal_id = $${args.length}::uuid`;
  }
  const prodQ = await p.query<{
    id: string; nombre: string; sku: string | null; unidad_medida: string | null;
    rubro_id: string | null; rubro_nombre: string | null; stock_actual: string | null;
  }>(
    `SELECT p.id::text AS id, p.nombre, p.sku, p.unidad_medida,
            p.categoria_principal_id::text AS rubro_id,
            c.nombre AS rubro_nombre,
            p.stock_actual
       FROM ${tP} p
       LEFT JOIN ${tC} c ON c.id = p.categoria_principal_id
      WHERE p.empresa_id = $1::uuid${SUC_P}${filtroRubro}
      ORDER BY p.nombre`,
    args
  );

  const filas: FilaValoracion[] = [];
  for (const pr of prodQ.rows) {
    const e = estados.get(pr.id);
    // Sin movimientos hasta esa fecha, el producto no existía en el depósito.
    // Se omite en vez de listarlo en cero: una planilla con cientos de ceros
    // esconde las líneas que importan.
    if (!e || (e.stock <= 0 && e.indeterminados === 0)) continue;

    const cantidad = e.stock;
    const costo = e.costo;
    filas.push({
      producto_id: pr.id,
      nombre: pr.nombre,
      sku: pr.sku,
      unidad: pr.unidad_medida,
      rubro_id: pr.rubro_id,
      rubro_nombre: pr.rubro_nombre,
      cantidad,
      costo_unitario: costo,
      valor_total: cantidad * costo,
      stock_hoy: Number(pr.stock_actual) || 0,
      indeterminados: e.indeterminados,
    });
  }

  return {
    corte,
    filas,
    total_articulos: filas.length,
    total_unidades: filas.reduce((s, f) => s + f.cantidad, 0),
    valor_total: filas.reduce((s, f) => s + f.valor_total, 0),
    indeterminados: filas.reduce((s, f) => s + f.indeterminados, 0),
    truncado,
  };
}
