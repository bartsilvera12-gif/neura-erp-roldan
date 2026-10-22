/**
 * PG directo para catalogos de Inventario:
 *   - categorias_productos
 *   - inventario_ubicaciones
 *   - producto_categorias (puente)
 *   - inventario_stock_ubicacion (stock por ubicacion)
 *
 * Multi-tenant: schema validado con assertAllowedChatDataSchema, tablas
 * citadas con quoteSchemaTable, valores via placeholders $N.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

// ─── Categorias de productos ──────────────────────────────────────────────

export interface CategoriaProductoRow {
  id: string;
  empresa_id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Auto-sync: importa a categorias_productos cualquier rubro de proveedor
 * (proveedor_categorias) activo que no exista todavia, comparando por
 * lower(trim(nombre)). Idempotente y protegido por UNIQUE INDEX
 * uq_categorias_productos_empresa_nombre.
 *
 * Esto unifica los dos catalogos desde el punto de vista del usuario:
 * lo que cargo como rubro del proveedor aparece tambien como categoria
 * de producto, sin obligar al usuario a duplicar la carga.
 */
async function seedCategoriasFromProveedor(schema: string, empresaId: string): Promise<void> {
  const tProd = quoteSchemaTable(schema, "categorias_productos");
  const tProv = quoteSchemaTable(schema, "proveedor_categorias");
  try {
    await pool().query(
      `INSERT INTO ${tProd} (empresa_id, nombre, activo)
       SELECT pc.empresa_id, pc.nombre, true
         FROM ${tProv} pc
        WHERE pc.empresa_id = $1::uuid
          AND pc.activo = true
          AND NOT EXISTS (
            SELECT 1 FROM ${tProd} cp
             WHERE cp.empresa_id = pc.empresa_id
               AND lower(trim(cp.nombre)) = lower(trim(pc.nombre))
          )`,
      [empresaId]
    );
  } catch (err) {
    // Si proveedor_categorias no existe en este schema, ignorar.
    const msg = err instanceof Error ? err.message : "";
    if (!/proveedor_categorias.*does not exist|relation .* does not exist/i.test(msg)) {
      console.error("[catalogos-pg] seedCategoriasFromProveedor", { schema, message: msg });
    }
  }
}

export async function listCategoriasProducto(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivas?: boolean } = {}
): Promise<CategoriaProductoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const p = pool();

  // Sync una sola vez por empresa: si ya hay rows, no corremos el INSERT.
  // Evita gastar conexiones del pool (limite 15 en session mode) en cada GET.
  const probe = await p.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
    [empresaId]
  );
  if (Number(probe.rows[0]?.c ?? 0) === 0) {
    await seedCategoriasFromProveedor(schema, empresaId);
  }

  const where = ["empresa_id = $1::uuid"];
  if (opts.soloActivas !== false) where.push("activo = true");
  const { rows } = await p.query<CategoriaProductoRow>(
    `SELECT id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at
       FROM ${t}
      WHERE ${where.join(" AND ")}
      ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

export async function insertCategoriaProducto(
  schemaRaw: string,
  empresaId: string,
  d: { nombre: string; codigo?: string | null; descripcion?: string | null; parent_id?: string | null; activo?: boolean }
): Promise<CategoriaProductoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const { rows } = await pool().query<CategoriaProductoRow>(
    `INSERT INTO ${t} (empresa_id, nombre, codigo, descripcion, parent_id, activo)
     VALUES ($1::uuid, $2, $3, $4, $5, COALESCE($6::boolean, true))
     RETURNING id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at`,
    [
      empresaId,
      d.nombre.trim(),
      d.codigo?.trim() || null,
      d.descripcion?.trim() || null,
      d.parent_id || null,
      d.activo ?? true,
    ]
  );
  return rows[0];
}

export async function updateCategoriaProducto(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<{ nombre: string; codigo: string | null; descripcion: string | null; parent_id: string | null; activo: boolean }>
): Promise<CategoriaProductoRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(d.nombre.trim()); }
  if (d.codigo !== undefined) { sets.push(`codigo = $${i++}`); params.push(d.codigo?.trim() || null); }
  if (d.descripcion !== undefined) { sets.push(`descripcion = $${i++}`); params.push(d.descripcion?.trim() || null); }
  if (d.parent_id !== undefined) { sets.push(`parent_id = $${i++}`); params.push(d.parent_id || null); }
  if (d.activo !== undefined) { sets.push(`activo = $${i++}::boolean`); params.push(d.activo); }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<CategoriaProductoRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
      RETURNING id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at`,
    params
  );
  return rows[0] ?? null;
}

// ─── Ubicaciones ──────────────────────────────────────────────────────────

const TIPOS_UBICACION = ["deposito", "salon", "pasillo", "gondola", "estante", "zona", "otro"] as const;
export type TipoUbicacion = typeof TIPOS_UBICACION[number];
function normTipo(t: unknown): TipoUbicacion {
  return TIPOS_UBICACION.includes(t as TipoUbicacion) ? (t as TipoUbicacion) : "deposito";
}

export interface UbicacionRow {
  id: string;
  empresa_id: string;
  /** null en filas legacy anteriores a la migración. */
  sucursal_id: string | null;
  nombre: string;
  codigo: string | null;
  tipo: TipoUbicacion;
  parent_id: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export async function listUbicaciones(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivas?: boolean; sucursalId?: string | null } = {}
): Promise<UbicacionRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const where = ["empresa_id = $1::uuid"];
  const params: unknown[] = [empresaId];
  if (opts.soloActivas !== false) where.push("activo = true");
  if (opts.sucursalId) {
    // Depósitos vinculados a la sucursal actual + los sin sucursal (compat legacy).
    params.push(opts.sucursalId);
    where.push(`(sucursal_id = $${params.length}::uuid OR sucursal_id IS NULL)`);
  }
  const { rows } = await pool().query<UbicacionRow>(
    `SELECT id, empresa_id, sucursal_id, nombre, codigo, tipo, parent_id, descripcion, activo, created_at, updated_at
       FROM ${t} WHERE ${where.join(" AND ")} ORDER BY nombre`,
    params
  );
  return rows;
}

export async function insertUbicacion(
  schemaRaw: string,
  empresaId: string,
  d: { nombre: string; codigo?: string | null; tipo?: string; parent_id?: string | null; descripcion?: string | null; activo?: boolean; sucursal_id?: string | null }
): Promise<UbicacionRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const { rows } = await pool().query<UbicacionRow>(
    `INSERT INTO ${t} (empresa_id, sucursal_id, nombre, codigo, tipo, parent_id, descripcion, activo)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, COALESCE($8::boolean, true))
     RETURNING id, empresa_id, sucursal_id, nombre, codigo, tipo, parent_id, descripcion, activo, created_at, updated_at`,
    [
      empresaId,
      d.sucursal_id || null,
      d.nombre.trim(),
      d.codigo?.trim() || null,
      normTipo(d.tipo),
      d.parent_id || null,
      d.descripcion?.trim() || null,
      d.activo ?? true,
    ]
  );
  return rows[0];
}

export async function updateUbicacion(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<{ nombre: string; codigo: string | null; tipo: string; parent_id: string | null; descripcion: string | null; activo: boolean }>
): Promise<UbicacionRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(d.nombre.trim()); }
  if (d.codigo !== undefined) { sets.push(`codigo = $${i++}`); params.push(d.codigo?.trim() || null); }
  if (d.tipo !== undefined) { sets.push(`tipo = $${i++}`); params.push(normTipo(d.tipo)); }
  if (d.parent_id !== undefined) { sets.push(`parent_id = $${i++}`); params.push(d.parent_id || null); }
  if (d.descripcion !== undefined) { sets.push(`descripcion = $${i++}`); params.push(d.descripcion?.trim() || null); }
  if (d.activo !== undefined) { sets.push(`activo = $${i++}::boolean`); params.push(d.activo); }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<UbicacionRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
      RETURNING id, empresa_id, nombre, codigo, tipo, parent_id, descripcion, activo, created_at, updated_at`,
    params
  );
  return rows[0] ?? null;
}

// ─── Relacion producto<->categoria principal ────────────────────────────

/**
 * Sincroniza la categoria principal: limpia es_principal previo y reinserta
 * (o actualiza) la fila marcada. Tambien asegura que el producto figure
 * en producto_categorias (puente N:N) cuando la categoria viene seleccionada.
 */
export async function setCategoriaPrincipal(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  categoriaId: string | null
): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "producto_categorias");
  const p = pool();
  // 1) Limpiar es_principal previo
  await p.query(
    `UPDATE ${t} SET es_principal = false
      WHERE empresa_id = $1::uuid AND producto_id = $2::uuid AND es_principal = true`,
    [empresaId, productoId]
  );
  if (!categoriaId) return;
  // 2) Upsert con es_principal=true
  await p.query(
    `INSERT INTO ${t} (empresa_id, producto_id, categoria_id, es_principal)
     VALUES ($1::uuid, $2::uuid, $3::uuid, true)
     ON CONFLICT (empresa_id, producto_id, categoria_id)
     DO UPDATE SET es_principal = true`,
    [empresaId, productoId, categoriaId]
  );
}

// ─── Stock por ubicacion (inicial al crear producto) ────────────────────

/**
 * Devuelve el mensaje de error si ya existe otra ubicación con ese código o
 * nombre. La comparación ignora mayúsculas: "dep-01" y "DEP-01" son el mismo
 * depósito para quien lo usa, aunque Postgres los vea distintos.
 */
export async function ubicacionDuplicada(
  schemaRaw: string,
  empresaId: string,
  campos: { codigo?: string | null; nombre?: string | null },
  excluirId?: string
): Promise<string | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

  if (campos.codigo && norm(campos.codigo)) {
    const { rows } = await pool().query<{ codigo: string }>(
      `SELECT codigo FROM ${t}
        WHERE empresa_id = $1::uuid AND lower(btrim(codigo)) = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [empresaId, norm(campos.codigo), excluirId ?? null]
    );
    if (rows[0]) return `Ya existe un depósito con el código "${rows[0].codigo}".`;
  }
  if (campos.nombre && norm(campos.nombre)) {
    const { rows } = await pool().query<{ nombre: string }>(
      `SELECT nombre FROM ${t}
        WHERE empresa_id = $1::uuid AND lower(btrim(nombre)) = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [empresaId, norm(campos.nombre), excluirId ?? null]
    );
    if (rows[0]) return `Ya existe un depósito llamado "${rows[0].nombre}".`;
  }
  return null;
}

/**
 * Borra una ubicación. Solo si no tiene stock ni la referencia ningún
 * movimiento: un depósito con historial se desactiva, no se borra, porque
 * borrarlo dejaría movimientos apuntando a la nada.
 *
 * Devuelve el motivo del rechazo, o `null` si la borró.
 */
export async function deleteUbicacion(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<string | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tUbi = quoteSchemaTable(schema, "inventario_ubicaciones");
  const tStock = quoteSchemaTable(schema, "inventario_stock_ubicacion");

  const stock = await pool().query<{ n: string }>(
    `SELECT count(*) AS n FROM ${tStock}
      WHERE empresa_id = $1::uuid AND ubicacion_id = $2::uuid AND COALESCE(stock_actual, 0) <> 0`,
    [empresaId, id]
  );
  if (Number(stock.rows[0]?.n ?? 0) > 0) {
    return "El depósito todavía tiene stock. Transferilo o ajustalo a cero antes de borrarlo.";
  }

  const hijos = await pool().query<{ n: string }>(
    `SELECT count(*) AS n FROM ${tUbi} WHERE empresa_id = $1::uuid AND parent_id = $2::uuid`,
    [empresaId, id]
  );
  if (Number(hijos.rows[0]?.n ?? 0) > 0) {
    return "El depósito tiene ubicaciones adentro. Borralas o movelas primero.";
  }

  try {
    await pool().query(
      `DELETE FROM ${tUbi} WHERE empresa_id = $1::uuid AND id = $2::uuid`,
      [empresaId, id]
    );
  } catch (e) {
    // Alguna FK que no previmos: se desactiva y se avisa, en vez de romper.
    const msg = e instanceof Error ? e.message : String(e);
    if (/foreign key|violates/i.test(msg)) {
      return "El depósito está referenciado por movimientos ya registrados. Desactivalo en lugar de borrarlo.";
    }
    throw e;
  }
  return null;
}

export async function setStockUbicacionInicial(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  ubicacionId: string,
  cantidad: number
): Promise<void> {
  if (cantidad <= 0) return;
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_stock_ubicacion");
  await pool().query(
    `INSERT INTO ${t} (empresa_id, producto_id, ubicacion_id, stock_actual, es_principal)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, true)
     ON CONFLICT (empresa_id, producto_id, ubicacion_id)
     DO UPDATE SET stock_actual = ${t}.stock_actual + EXCLUDED.stock_actual, updated_at = now()`,
    [empresaId, productoId, ubicacionId, cantidad]
  );
}

export interface StockUbicacionRow {
  id: string;
  producto_id: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  ubicacion_tipo: string;
  stock_actual: string | number;
  es_principal: boolean;
}

export async function listStockPorUbicacion(
  schemaRaw: string,
  empresaId: string,
  productoId: string
): Promise<StockUbicacionRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tS = quoteSchemaTable(schema, "inventario_stock_ubicacion");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
  const { rows } = await pool().query<StockUbicacionRow>(
    `SELECT s.id, s.producto_id, s.ubicacion_id,
            u.nombre AS ubicacion_nombre, u.tipo AS ubicacion_tipo,
            s.stock_actual, s.es_principal
       FROM ${tS} s
       JOIN ${tU} u ON u.id = s.ubicacion_id
      WHERE s.empresa_id = $1::uuid AND s.producto_id = $2::uuid
      ORDER BY s.es_principal DESC, u.nombre`,
    [empresaId, productoId]
  );
  return rows;
}
