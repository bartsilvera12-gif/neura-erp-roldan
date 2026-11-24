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

/**
 * ¿Ya corrió el script 104 (aprobación y recepción de compras)? Se pregunta
 * una vez por esquema y se recuerda solo el «sí», así cuando el script corre
 * se nota sin reiniciar. Sin el script, las compras andan como antes: el
 * stock entra al guardar.
 */
const conAprobacionCache = new Map<string, boolean>();
export async function comprasConAprobacion(schemaRaw: string): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (conAprobacionCache.get(schema)) return true;
  const { rows } = await pool().query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'compras' AND column_name = 'stock_aplicado' LIMIT 1`,
    [schema]
  );
  const hay = rows.length > 0;
  if (hay) conAprobacionCache.set(schema, true);
  return hay;
}

/** Columnas del flujo de aprobación/recepción (script 104). */
const COLS_FLUJO = `stock_aplicado, recepcion,
  aprobada_1_por, aprobada_1_nombre, aprobada_1_at,
  aprobada_2_por, aprobada_2_nombre, aprobada_2_at,
  en_transito_nombre, en_transito_at, recibida_nombre, recibida_at`;
const COLS_FLUJO_NULOS = `true AS stock_aplicado, NULL::text AS recepcion,
  NULL::uuid AS aprobada_1_por, NULL::text AS aprobada_1_nombre, NULL::timestamptz AS aprobada_1_at,
  NULL::uuid AS aprobada_2_por, NULL::text AS aprobada_2_nombre, NULL::timestamptz AS aprobada_2_at,
  NULL::text AS en_transito_nombre, NULL::timestamptz AS en_transito_at,
  NULL::text AS recibida_nombre, NULL::timestamptz AS recibida_at`;

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
  /** Script 104. Las compras de antes del script: stock_aplicado=true, recepcion=null. */
  stock_aplicado?: boolean;
  recepcion?: string | null;
  aprobada_1_por?: string | null;
  aprobada_1_nombre?: string | null;
  aprobada_1_at?: string | null;
  aprobada_2_por?: string | null;
  aprobada_2_nombre?: string | null;
  aprobada_2_at?: string | null;
  en_transito_nombre?: string | null;
  en_transito_at?: string | null;
  recibida_nombre?: string | null;
  recibida_at?: string | null;
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
  const flujo = (await comprasConAprobacion(schemaRaw)) ? COLS_FLUJO : COLS_FLUJO_NULOS;
  // El tope va por COMPRA, no por fila. Una compra son varias filas (una por
  // ítem) y `LIMIT 500` sobre filas cortaba la última compra por la mitad:
  // aparecía con menos ítems y un total menor al real.
  const { rows } = await pool().query<CompraRow>(
    `WITH ult AS (
       SELECT numero_control FROM ${t}
        WHERE empresa_id = $1::uuid AND sucursal_id = $2::uuid
        GROUP BY numero_control
        ORDER BY MAX(fecha) DESC
        LIMIT ${LIMITE_COMPRAS_LISTADO}
     )
     SELECT ${COLS}, ${flujo} FROM ${t}
      WHERE empresa_id = $1::uuid AND sucursal_id = $2::uuid
        AND numero_control IN (SELECT numero_control FROM ult)
      ORDER BY fecha DESC`,
    [empresaId, sucursalId]
  );
  return rows;
}

/** Cuántas compras (no filas) trae el listado. El histórico completo está en Libro de compras. */
export const LIMITE_COMPRAS_LISTADO = 300;

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
  items: CompraItemInput[],
  /**
   * `diferirStock` (script 104): la compra se guarda sin tocar el stock; entra
   * cuando un administrador la marca «Recibido», después de las dos
   * aprobaciones. `aprobacionInicial`: quien la carga es administrador y su
   * carga cuenta como la primera aprobación.
   */
  opciones?: { diferirStock?: boolean; aprobacionInicial?: { por: string | null; nombre: string | null } | null }
): Promise<ComprasMultiResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const diferir = opciones?.diferirStock === true;
  const aprob = opciones?.aprobacionInicial ?? null;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La compra no tiene productos.");
  }
  const tC = quoteSchemaTable(schema, "compras");
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
           created_by, usuario_nombre, sucursal_id, numero_factura${diferir ? `,
           stock_aplicado, recepcion, ubicacion_destino_id, precio_venta_usd,
           aprobada_1_por, aprobada_1_nombre, aprobada_1_at` : ""}
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4::uuid, $5,
           $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
           $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
           $17, $18::integer, $19, $20, 'registrada', now(),
           $21::date, $22,
           $23, $24, $25, $26,
           $27::uuid, $28, $29::uuid, $30${diferir ? `,
           false, 'pendiente', $31::uuid, $32::numeric,
           $33::uuid, $34, CASE WHEN $34::text IS NULL THEN NULL ELSE now() END` : ""}
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
          ...(diferir
            ? [ubicacionId, it.precio_venta_usd ?? null, aprob?.por ?? null, aprob ? (aprob.nombre ?? "Administrador") : null]
            : []),
        ]
      );
      insertedRows.push(compraRows[0]);
      // Con aprobación, el stock entra al marcar «Recibido» (avanzarFlujoCompra).
      if (diferir) continue;

      const sinDeposito = await aplicarImpactoLinea(client, schemaRaw, empresaId, sucursalId, {
        numero,
        proveedor_id: header.proveedor_id,
        moneda: header.moneda,
        ubicacion_id: ubicacionId,
        created_by: header.created_by,
        usuario_nombre: header.usuario_nombre,
      }, it);
      if (sinDeposito) warnings.push(it.producto_nombre);
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

/**
 * Lo que una línea de compra le hace al inventario: movimiento ENTRADA, stock
 * y costo promedio ponderado del producto, precio de venta (y en dólares),
 * último costo en dólares, stock del depósito y la relación con el proveedor.
 *
 * Lo usa la compra al guardarse (sin aprobación) y la compra aprobada al
 * marcarse «Recibido». Devuelve true si no hubo depósito donde sumar.
 */
async function aplicarImpactoLinea(
  client: import("pg").PoolClient,
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  h: {
    numero: string;
    proveedor_id: string;
    moneda: string;
    ubicacion_id: string | null;
    created_by: string | null;
    usuario_nombre: string | null;
  },
  it: {
    producto_id: string;
    producto_nombre: string;
    cantidad: number;
    costo_unitario: number;
    costo_unitario_original: number;
    precio_venta: number;
    precio_venta_usd?: number | null;
  }
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");
  const tSU = quoteSchemaTable(schema, "inventario_stock_ubicacion");

  // Movimiento ENTRADA (origen compra).
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
      it.cantidad, it.costo_unitario, h.numero, h.created_by, h.usuario_nombre,
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
            -- Si la compra vino en dólares y trae precio de venta, se guarda el
            -- dólar y precio_venta queda con el guaraní al cambio de ESTA compra.
            precio_usd = CASE WHEN $6::numeric > 0 THEN $6::numeric ELSE precio_usd END,
            -- Último costo en dólares (pedido del cliente): la próxima compra
            -- en dólares de este producto arranca con este valor.
            costo_usd = CASE WHEN $7::numeric > 0 THEN $7::numeric ELSE costo_usd END,
            updated_at = now()
      WHERE id = $4::uuid AND empresa_id = $5::uuid`,
    [it.cantidad, it.costo_unitario, it.precio_venta, it.producto_id, empresaId,
     Number(it.precio_venta_usd) || 0,
     h.moneda === "USD" ? Number(it.costo_unitario_original) || 0 : 0]
  );

  // Sumar al depósito. Si la compra no eligió depósito, va al principal del producto.
  let ubi: string | null = h.ubicacion_id;
  if (!ubi) {
    const r = await client.query<{ ubicacion_principal_id: string | null }>(
      `SELECT ubicacion_principal_id FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [it.producto_id, empresaId]
    );
    ubi = r.rows[0]?.ubicacion_principal_id ?? null;
  }
  let sinDeposito = false;
  if (ubi) {
    await client.query(
      `INSERT INTO ${tSU} (empresa_id, ubicacion_id, producto_id, stock_actual, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, now())
       ON CONFLICT (empresa_id, ubicacion_id, producto_id)
       DO UPDATE SET stock_actual = ${tSU}.stock_actual + EXCLUDED.stock_actual, updated_at = now()`,
      [empresaId, ubi, it.producto_id, it.cantidad]
    );
  } else {
    sinDeposito = true;
  }

  // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
  await upsertProveedorProducto(client, tPP, empresaId, it.producto_id, h.proveedor_id, it.costo_unitario);
  return sinDeposito;
}

export type AccionFlujoCompra = "aprobar" | "en_transito" | "recibido";

/**
 * Aprobación y recepción de una compra (pedido del cliente, como las órdenes
 * de compra): dos administradores distintos la aprueban (quien la carga, si es
 * administrador, cuenta como el primero); después un administrador la marca
 * «En tránsito» y «Recibido». Recién con «Recibido» entra al stock.
 *
 * Todo en una transacción con las filas bloqueadas: dos clics a la vez no
 * pueden sumar el stock dos veces.
 */
export async function avanzarFlujoCompra(
  schemaRaw: string,
  empresaId: string,
  numero: string,
  accion: AccionFlujoCompra,
  quien: { id: string | null; nombre: string; sucursal_id: string | null }
): Promise<{ mensaje: string; warning: string | null }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<CompraRow & { sucursal_id: string | null; ubicacion_destino_id: string | null; precio_venta_usd: string | number | null; created_by: string | null }>(
      `SELECT ${COLS}, ${COLS_FLUJO}, sucursal_id, ubicacion_destino_id, precio_venta_usd
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND numero_control = $2
        ORDER BY created_at
        FOR UPDATE`,
      [empresaId, numero]
    );
    if (rows.length === 0) throw new ErrorFlujo("Compra no encontrada.", 404);
    const h = rows[0];
    if (rows.every((r) => r.estado === "anulada")) throw new ErrorFlujo("La compra está anulada.");
    if (h.stock_aplicado !== false && h.recepcion == null) {
      throw new ErrorFlujo("Esta compra es de antes de las aprobaciones: ya entró al stock.");
    }
    const aprobaciones = (h.aprobada_1_nombre ? 1 : 0) + (h.aprobada_2_nombre ? 1 : 0);
    let mensaje = "";
    let warning: string | null = null;

    if (accion === "aprobar") {
      if (aprobaciones >= 2) throw new ErrorFlujo("La compra ya tiene las dos aprobaciones.");
      if (quien.id && h.aprobada_1_por && h.aprobada_1_por === quien.id) {
        throw new ErrorFlujo("Ya la aprobaste. Falta la aprobación de otro administrador.");
      }
      const n = h.aprobada_1_nombre ? 2 : 1;
      await client.query(
        `UPDATE ${tC} SET aprobada_${n}_por = $3::uuid, aprobada_${n}_nombre = $4, aprobada_${n}_at = now(), updated_at = now()
          WHERE empresa_id = $1::uuid AND numero_control = $2`,
        [empresaId, numero, quien.id, quien.nombre]
      );
      mensaje = n === 2 ? `${numero} aprobada (2/2). Ya se puede marcar En tránsito o Recibido.` : `${numero}: aprobación 1/2. Falta otro administrador.`;
    } else {
      if (aprobaciones < 2) throw new ErrorFlujo("Faltan aprobaciones: la compra necesita dos administradores antes de recibirse.");
      if (h.recepcion === "recibida") throw new ErrorFlujo("La compra ya fue recibida.");
      if (accion === "en_transito") {
        await client.query(
          `UPDATE ${tC} SET recepcion = 'en_transito', en_transito_nombre = $3, en_transito_at = now(), updated_at = now()
            WHERE empresa_id = $1::uuid AND numero_control = $2`,
          [empresaId, numero, quien.nombre]
        );
        mensaje = `${numero} en tránsito.`;
      } else {
        // «Recibido»: recién acá entra al stock.
        const sinDeposito: string[] = [];
        if (h.stock_aplicado === false) {
          for (const r of rows) {
            if (r.estado === "anulada") continue;
            const falta = await aplicarImpactoLinea(client, schemaRaw, empresaId, r.sucursal_id ?? quien.sucursal_id ?? "", {
              numero,
              proveedor_id: r.proveedor_id,
              moneda: r.moneda,
              ubicacion_id: r.ubicacion_destino_id ?? null,
              created_by: quien.id,
              usuario_nombre: quien.nombre,
            }, {
              producto_id: r.producto_id,
              producto_nombre: r.producto_nombre,
              cantidad: Number(r.cantidad) || 0,
              costo_unitario: Number(r.costo_unitario) || 0,
              costo_unitario_original: Number(r.costo_unitario_original) || 0,
              precio_venta: Number(r.precio_venta) || 0,
              precio_venta_usd: r.precio_venta_usd != null ? Number(r.precio_venta_usd) : null,
            });
            if (falta) sinDeposito.push(r.producto_nombre);
          }
        }
        await client.query(
          `UPDATE ${tC} SET recepcion = 'recibida', recibida_nombre = $3, recibida_at = now(),
                  stock_aplicado = true, updated_at = now()
            WHERE empresa_id = $1::uuid AND numero_control = $2`,
          [empresaId, numero, quien.nombre]
        );
        mensaje = `${numero} recibida: la mercadería entró al stock.`;
        if (sinDeposito.length) {
          warning = `Stock global actualizado, pero sin depósito para: ${sinDeposito.join(", ")}. Asigná el depósito principal al producto.`;
        }
      }
    }
    await client.query("COMMIT");
    return { mensaje, warning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/** Error del flujo con mensaje para mostrar tal cual. */
export class ErrorFlujo extends Error {
  status: number;
  constructor(msg: string, status = 409) {
    super(msg);
    this.status = status;
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
