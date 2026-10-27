/**
 * Consultas de los informes que el cliente venía sacando del sistema viejo y
 * que acá no existían: anticipos, egresos y el detalle de utilidad por línea.
 *
 * ── POR QUÉ ESTÁN LOS TRES JUNTOS ────────────────────────────────────────
 *   No comparten tablas, comparten la forma: los tres son "todo lo del mes,
 *   una fila por operación, sin agrupar". Son los que el contador cruza
 *   contra el papel, y lo que importa en los tres es que no falte ni sobre
 *   ninguna fila. Tenerlos en un archivo deja a la vista que el filtro de
 *   fechas y el de sucursal tienen que ser el mismo en los tres: si uno
 *   recorta distinto, los totales del paquete dejan de cerrar entre sí.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible");
  return p;
}

export interface AnticipoRow {
  numero: string | null;
  fecha: string;
  cliente_nombre: string | null;
  cliente_ruc: string | null;
  monto: string | number;
  medio_pago: string | null;
  estado: string | null;
  factura: string | null;
  usuario_nombre: string | null;
  observacion: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
}

/**
 * Anticipos del mes (equivale a `anticipo-<mes>-<año>_<SUCURSAL>.xls`).
 *
 * Se incluyen los anulados, marcados en su columna, por el mismo motivo que
 * en cobranzas: hace falta verlos para saber qué se deshizo. Por eso el
 * importe no se totaliza en el detalle.
 *
 * `venta_id` se resuelve al número de la factura contra la que se liquidó:
 * el uuid no le dice nada a nadie, y en el archivo viejo esa columna traía
 * justamente el número de factura.
 */
export async function getAnticiposDelMes(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: { start: string; end: string }
): Promise<AnticipoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tA = quoteSchemaTable(schema, "anticipos");
  const tV = quoteSchemaTable(schema, "ventas");
  const tC = quoteSchemaTable(schema, "clientes");
  const { rows } = await pool().query<AnticipoRow>(
    `SELECT a.numero,
            a.fecha,
            a.cliente_nombre,
            c.ruc                       AS cliente_ruc,
            a.monto,
            a.medio_pago,
            a.estado,
            v.numero_control            AS factura,
            a.usuario_nombre,
            a.observacion,
            (a.anulado_at IS NOT NULL)  AS anulado,
            a.anulado_motivo
       FROM ${tA} a
       LEFT JOIN ${tV} v ON v.id = a.venta_id
       LEFT JOIN ${tC} c ON c.id = a.cliente_id
      WHERE a.empresa_id = $1::uuid
        AND a.sucursal_id = $2::uuid
        AND a.fecha >= $3::timestamptz AND a.fecha <= $4::timestamptz
      ORDER BY a.fecha, a.numero`,
    [empresaId, sucursalId, b.start, b.end]
  );
  return rows;
}

export interface EgresoRow {
  fecha: string;
  rubro: string | null;
  descripcion: string | null;
  beneficiario: string | null;
  proveedor_ruc: string | null;
  nro_timbrado: string | null;
  numero_factura: string | null;
  metodo_pago: string | null;
  exenta: string | number;
  gravado_5: string | number;
  iva_5: string | number;
  gravado_10: string | number;
  iva_10: string | number;
  monto: string | number;
}

/**
 * Egresos del mes (equivale a `egreso-<mes>-<año>_<SUCURSAL>.xls`).
 *
 * ── POR QUÉ NO ALCANZABA EL LIBRO DE COMPRAS ─────────────────────────────
 *   El libro de compras deja los gastos afuera a propósito: muchos no tienen
 *   timbrado ni número de factura y ensuciarían un libro fiscal. Pero el
 *   alquiler, la luz y el teléfono son plata que salió, y el contador los
 *   necesita igual. Este informe es ese otro lado: todo lo que salió, con el
 *   desglose de IVA cuando lo hay, sin pretender ser un libro fiscal.
 */
export async function getEgresosDelMes(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: { start: string; end: string }
): Promise<EgresoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tG = quoteSchemaTable(schema, "gastos");
  const { rows } = await pool().query<EgresoRow>(
    `SELECT g.fecha,
            g.categoria                      AS rubro,
            g.descripcion,
            g.beneficiario,
            g.proveedor_ruc,
            g.nro_timbrado,
            g.numero_factura,
            g.metodo_pago,
            COALESCE(g.monto_exenta, 0)      AS exenta,
            COALESCE(g.gravado_5, 0)         AS gravado_5,
            COALESCE(g.iva_5, 0)             AS iva_5,
            COALESCE(g.gravado_10, 0)        AS gravado_10,
            COALESCE(g.iva_10, 0)            AS iva_10,
            COALESCE(g.monto, 0)             AS monto
       FROM ${tG} g
      WHERE g.empresa_id = $1::uuid
        AND g.sucursal_id = $2::uuid
        AND g.fecha >= $3::timestamptz AND g.fecha <= $4::timestamptz
      ORDER BY g.fecha, g.numero_factura`,
    [empresaId, sucursalId, b.start, b.end]
  );
  return rows;
}

export interface UtilidadLineaRow {
  fecha: string;
  numero_control: string | null;
  tipo_venta: string | null;
  cliente: string | null;
  producto: string | null;
  sku: string | null;
  rubro: string | null;
  cantidad: number;
  precio_unitario: number;
  facturacion: number;
  costo: number;
  ganancia: number;
}

/**
 * Detalle de utilidad, una fila por línea de venta (equivale a
 * `venta_utilidad-<mes>-<año>_<SUCURSAL>.xls`, que traía 2.233 filas).
 *
 * ── POR QUÉ HACE FALTA ADEMÁS DE LOS TOTALES POR RUBRO ───────────────────
 *   El informe por rubro dice que un rubro dejó poco; éste dice en qué venta
 *   concreta se perdió el margen. Sin él, cuando un rubro cae no hay forma de
 *   saber si fue un descuento puntual, una venta grande al costo o un precio
 *   mal cargado.
 *
 * ── EL COSTO SALE DEL MOVIMIENTO, NO DEL PRODUCTO ────────────────────────
 *   Se toma de `movimientos_inventario`, que guarda el costo que tenía el
 *   artículo EN EL MOMENTO de esa venta. El costo de hoy serviría para la
 *   venta de hoy y mentiría para todas las anteriores: si el proveedor
 *   aumentó, las ventas de hace tres meses aparecerían con menos ganancia de
 *   la que realmente dejaron.
 *
 *   Se le saca el IVA con la tasa del artículo, igual que el informe por
 *   rubro, para que los dos den el mismo total y no haya que explicar una
 *   diferencia.
 */
export async function getUtilidadDetalle(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: { start: string; end: string }
): Promise<UtilidadLineaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tCat = quoteSchemaTable(schema, "categorias_productos");
  const tC = quoteSchemaTable(schema, "clientes");

  const { rows } = await pool().query<UtilidadLineaRow>(
    `WITH vp AS (
       SELECT v.id, v.fecha, v.numero_control, v.tipo_venta, v.cliente_id
         FROM ${tV} v
        WHERE v.empresa_id = $1::uuid
          AND v.sucursal_id = $2::uuid
          AND v.fecha >= $3::timestamptz AND v.fecha <= $4::timestamptz
          AND COALESCE(v.estado, 'completada') <> 'anulada'
          AND COALESCE(v.origen, '') <> 'consignacion'
     ),
     costo AS (
       -- Un producto puede tener más de un movimiento por venta (una línea
       -- cargada en dos veces); se suman por venta y producto antes de unir,
       -- porque si no el JOIN duplicaría la línea de venta.
       SELECT m.venta_id, m.producto_id,
              SUM((m.cantidad * m.costo_unitario) /
                  CASE COALESCE(pr.tipo_iva, '10%')
                    WHEN '10%' THEN 1.10 WHEN '5%' THEN 1.05 WHEN 'EXENTA' THEN 1.0 ELSE 1.10 END
              )::float8 AS costo
         FROM ${tM} m
         JOIN vp ON vp.id = m.venta_id
         LEFT JOIN ${tP} pr ON pr.id = m.producto_id AND pr.empresa_id = $1::uuid
        WHERE m.empresa_id = $1::uuid AND m.tipo = 'SALIDA' AND m.origen = 'venta'
        GROUP BY m.venta_id, m.producto_id
     )
     SELECT vp.fecha,
            vp.numero_control,
            vp.tipo_venta,
            cl.nombre                          AS cliente,
            vi.producto_nombre                 AS producto,
            vi.sku,
            COALESCE(cat.nombre, 'Sin rubro')  AS rubro,
            vi.cantidad::float8                AS cantidad,
            vi.precio_venta::float8            AS precio_unitario,
            vi.subtotal::float8                AS facturacion,
            COALESCE(c.costo, 0)::float8       AS costo,
            (vi.subtotal::float8 - COALESCE(c.costo, 0))::float8 AS ganancia
       FROM ${tVI} vi
       JOIN vp ON vp.id = vi.venta_id
       LEFT JOIN ${tP} p2 ON p2.id = vi.producto_id AND p2.empresa_id = $1::uuid
       LEFT JOIN ${tCat} cat ON cat.id = p2.categoria_principal_id
       LEFT JOIN ${tC} cl ON cl.id = vp.cliente_id
       LEFT JOIN costo c ON c.venta_id = vi.venta_id AND c.producto_id = vi.producto_id
      WHERE vi.empresa_id = $1::uuid
      ORDER BY vp.fecha, vp.numero_control, vi.producto_nombre`,
    [empresaId, sucursalId, b.start, b.end]
  );
  return rows;
}
