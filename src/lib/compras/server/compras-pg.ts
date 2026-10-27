/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * Upsert best-effort de la relación producto↔proveedor en `proveedor_productos`.
 * - Actualiza `costo_habitual` con el último costo_unitario de la compra.
 * - Marca `es_principal=true` SOLO si el producto aún no tiene un proveedor
 *   principal (respeta el índice parcial único un_principal).
 * - NUNCA toca `marca` (se preserva el valor existente; null si es nueva fila).
 * Se ejecuta dentro de un SAVEPOINT: si falla, no aborta la compra.
 */
async function upsertProveedorProducto(
  client: import("pg").PoolClient,
  tPP: string,
  empresaId: string,
  productoId: string,
  proveedorId: string,
  costoHabitual: number
): Promise<void> {
  if (!proveedorId) return; // sin proveedor no hay relación que mantener
  try {
    await client.query("SAVEPOINT sp_pp");
    await client.query(
      `INSERT INTO ${tPP} (empresa_id, producto_id, proveedor_id, costo_habitual, es_principal, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric,
               NOT EXISTS (SELECT 1 FROM ${tPP} pp
                            WHERE pp.empresa_id = $1::uuid AND pp.producto_id = $2::uuid AND pp.es_principal),
               now())
       ON CONFLICT (empresa_id, producto_id, proveedor_id)
       DO UPDATE SET costo_habitual = EXCLUDED.costo_habitual, updated_at = now()`,
      [empresaId, productoId, proveedorId, costoHabitual]
    );
    await client.query("RELEASE SAVEPOINT sp_pp");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_pp").catch(() => null);
    console.error("[compras-pg] upsert proveedor_productos fallo (best-effort)", {
      empresaId, productoId, proveedorId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_factura?: string | null;
  numero_control: string;
  estado: string;
  fecha: string;
  fecha_factura: string | null;
  metodo_pago: string | null;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
  anulada_at?: string | null;
  anulacion_motivo?: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_factura, numero_control, estado, fecha,
  fecha_factura, metodo_pago,
  comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
  created_at, updated_at, created_by, usuario_nombre
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  fecha_factura?: string | null;
  metodo_pago?: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

export async function listCompras(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string
): Promise<CompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS} FROM ${t} WHERE empresa_id = $1::uuid AND sucursal_id = $2::uuid ORDER BY fecha DESC LIMIT 500`,
    [empresaId, sucursalId]
  );
  return rows;
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string,
  sucursalId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid AND sucursal_id = $2::uuid`,
    [empresaId, sucursalId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

/** Cabecera compartida por todas las líneas de una compra multiproducto. */
export interface CompraHeaderInput {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: string;
  tipo_cambio: number;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  /** N° de la factura del proveedor (ej. 007-001-0016173). null si no se cargó. */
  numero_factura?: string | null;
  /** Fecha del comprobante fiscal del proveedor (YYYY-MM-DD). null si no se cargó. */
  fecha_factura: string | null;
  /** Método: 'efectivo' | 'transferencia' | 'tarjeta'. null si no se especificó. */
  metodo_pago: string | null;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

/** Una línea (producto) de la compra. */
export interface CompraItemInput {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  /** Precio de venta en dólares, cuando la compra vino en USD. */
  precio_venta_usd?: number | null;
  margen_venta: number | null;
}

export interface ComprasMultiResult {
  numero_control: string;
  compras: CompraRow[];
  movimiento_warning: string | null;
}

/** Cabecera para incluir el depósito destino (opcional). Aplica a toda la compra. */
export interface CompraHeaderWithDeposito extends CompraHeaderInput {
  ubicacion_id?: string | null;
}

/**
 * Compra MULTIPRODUCTO (modelo plano): N filas en `compras` que comparten un
 * único `numero_control`. Una sola transacción; por cada ítem inserta la fila,
 * el movimiento ENTRADA y actualiza stock + costo_promedio + precio_venta del
 * producto. Requiere que `numero_control` NO sea único (índice no-único).
 *
 * La compra simple es el caso N=1; el endpoint envuelve el body viejo en items=[…].
 */
export async function insertComprasConImpacto(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  header: CompraHeaderWithDeposito,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La compra no tiene productos.");
  }
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");
  const tSU = quoteSchemaTable(schema, "inventario_stock_ubicacion");
  const ubicacionId = header.ubicacion_id?.trim() || null;

  const client = await pool().connect();
  const insertedRows: CompraRow[] = [];
  const warnings: string[] = [];
  try {
    await client.query("BEGIN");
    const numero = await nextNumeroControl(client, schema, empresaId, sucursalId);

    for (const it of items) {
      const { rows: compraRows } = await client.query<CompraRow>(
        `INSERT INTO ${tC} (
           empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
           cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
           iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
           tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
           fecha_factura, metodo_pago,
           comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
           created_by, usuario_nombre, sucursal_id, numero_factura
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4::uuid, $5,
           $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
           $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
           $17, $18::integer, $19, $20, 'registrada', now(),
           $21::date, $22,
           $23, $24, $25, $26,
           $27::uuid, $28, $29::uuid, $30
         )
         RETURNING ${COLS}`,
        [
          empresaId, header.proveedor_id, header.proveedor_nombre,
          it.producto_id, it.producto_nombre,
          it.cantidad, header.moneda, header.tipo_cambio,
          it.costo_unitario_original, it.costo_unitario,
          it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
          header.tipo_pago, header.plazo_dias, header.nro_timbrado, numero,
          header.fecha_factura, header.metodo_pago,
          header.comprobante_url, header.comprobante_storage_path,
          header.comprobante_nombre, header.comprobante_mime_type,
          header.created_by, header.usuario_nombre, sucursalId,
          header.numero_factura ?? null,
        ]
      );
      insertedRows.push(compraRows[0]);

      // La compra SÍ impacta inventario: inserta movimiento ENTRADA, recalcula
      // CPP (costo promedio ponderado) sobre productos.stock_actual y suma la
      // cantidad al depósito destino en inventario_stock_ubicacion. Antes se
      // dejaba que el usuario cargara el movimiento por separado (esto llevaba
      // a compras registradas sin stock impactado).
      await client.query(
        `INSERT INTO ${tM} (
           empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha, created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4, COALESCE((SELECT sku FROM ${tP} WHERE id=$3::uuid), ''),
           'ENTRADA', $5::numeric, $6::numeric, 'compra', $7, now(), $8::uuid, $9
         )`,
        [
          empresaId, sucursalId, it.producto_id, it.producto_nombre,
          it.cantidad, it.costo_unitario, numero, header.created_by, header.usuario_nombre,
        ]
      );

      // Recalcular CPP: nuevo = (stock_prev·costo_prev + cantidad·costo_entrada) / (stock_prev+cantidad)
      // y sumar la cantidad al stock global. Precio_venta se pisa si viene > 0.
      await client.query(
        `UPDATE ${tP}
            SET stock_actual = COALESCE(stock_actual, 0) + $1::numeric,
                costo_promedio = CASE
                  WHEN COALESCE(stock_actual, 0) > 0
                    THEN (COALESCE(stock_actual,0) * COALESCE(costo_promedio,0) + $1::numeric * $2::numeric)
                         / (COALESCE(stock_actual,0) + $1::numeric)
                  ELSE $2::numeric
                END,
                precio_venta = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE precio_venta END,
                -- Si la compra vino en dólares y trae precio de venta, el
                -- producto pasa a venderse en dólares: de ahí en más el precio
                -- en guaraníes se calcula al vender, con la cotización del día.
                -- La columna precio_venta queda con el equivalente de hoy, para que
                -- lo que ya la lee siga mostrando un número con sentido.
                precio_usd = CASE WHEN $6::numeric > 0 THEN $6::numeric ELSE precio_usd END,
                updated_at = now()
          WHERE id = $4::uuid AND empresa_id = $5::uuid`,
        [it.cantidad, it.costo_unitario, it.precio_venta, it.producto_id, empresaId,
         it.precio_venta_usd ?? 0]
      );

      // Sumar al depósito (inventario_stock_ubicacion). Si no se eligió depósito,
      // resolvemos ubicacion_principal_id del producto como fallback.
      let ubiForItem: string | null = ubicacionId;
      if (!ubiForItem) {
        const r = await client.query<{ ubicacion_principal_id: string | null }>(
          `SELECT ubicacion_principal_id FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid`,
          [it.producto_id, empresaId]
        );
        ubiForItem = r.rows[0]?.ubicacion_principal_id ?? null;
      }
      if (ubiForItem) {
        await client.query(
          `INSERT INTO ${tSU} (empresa_id, ubicacion_id, producto_id, stock_actual, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, now())
           ON CONFLICT (empresa_id, ubicacion_id, producto_id)
           DO UPDATE SET stock_actual = ${tSU}.stock_actual + EXCLUDED.stock_actual, updated_at = now()`,
          [empresaId, ubiForItem, it.producto_id, it.cantidad]
        );
      } else {
        warnings.push(it.producto_nombre);
      }

      // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
      await upsertProveedorProducto(
        client, tPP, empresaId, it.producto_id, header.proveedor_id, it.costo_unitario
      );
    }

    await client.query("COMMIT");
    return {
      numero_control: numero,
      compras: insertedRows,
      movimiento_warning: warnings.length
        ? `Stock global actualizado, pero sin depósito destino para: ${warnings.join(", ")}. Asigná Depósito principal al producto o elegí depósito en la compra.`
        : null,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  const client = await pool().connect();
  let movimientoId: string | null = null;
  let movimientoWarning: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId, sucursalId);

    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
         fecha_factura, metodo_pago,
         created_by, usuario_nombre, sucursal_id
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, 'registrada', now(),
         $21::date, $22,
         $23::uuid, $24, $25::uuid
       )
       RETURNING ${COLS}`,
      [
        empresaId,
        d.proveedor_id,
        d.proveedor_nombre,
        d.producto_id,
        d.producto_nombre,
        d.cantidad,
        d.moneda,
        d.tipo_cambio,
        d.costo_unitario_original,
        d.costo_unitario,
        d.iva_tipo,
        d.subtotal,
        d.monto_iva,
        d.total,
        d.precio_venta,
        d.margen_venta,
        d.tipo_pago,
        d.plazo_dias,
        d.nro_timbrado,
        numero,
        d.fecha_factura ?? null,
        d.metodo_pago ?? null,
        d.created_by,
        d.usuario_nombre,
        sucursalId,
      ]
    );
    const compra = compraRows[0];

    // NOTA (Roldán e Hijos): la compra NO impacta inventario (no movimiento ENTRADA
    // ni suma stock). Es un registro de control/facturación — el stock lo carga
    // el usuario por Movimientos. Solo actualizamos costo/precio para el control
    // de costos.
    void tM;
    // CPP: la compra YA NO pisa costo_promedio (autoridad = ENTRADA de stock).
    // Solo actualiza precio de venta; el último costo queda en costo_habitual.
    await client.query(
      `UPDATE ${tP}
          SET precio_venta = CASE WHEN $1::numeric > 0 THEN $1::numeric ELSE precio_venta END,
              updated_at = now()
        WHERE id = $2::uuid AND empresa_id = $3::uuid`,
      [d.precio_venta, d.producto_id, empresaId]
    );

    // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
    await upsertProveedorProducto(
      client, tPP, empresaId, d.producto_id, d.proveedor_id, d.costo_unitario
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: movimientoWarning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
