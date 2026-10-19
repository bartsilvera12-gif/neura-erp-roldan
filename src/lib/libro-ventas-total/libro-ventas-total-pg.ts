import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Libro de Ventas TOTAL — reporte operativo (NO fiscal).
 *
 * Une:
 *   A) Ventas facturadas: ventas.factura_id NOT NULL con factura SIFEN aprobada
 *      (mismo criterio que el Libro fiscal, pero mostrado como fila individual)
 *   B) Ventas SOLO ticket: ventas.factura_id IS NULL (venta interna de Caja)
 *
 * Excluye anuladas. IVA se calcula sumando ventas_items agrupados por tipo_iva.
 *
 * A diferencia del Libro fiscal:
 *   - No incluye Notas de Crédito (esas son ajustes fiscales)
 *   - Incluye tickets internos (sin timbrado ni RUC cliente)
 *   - Sirve para conciliar caja vs facturación
 */

export interface LibroVentaTotalRow {
  origen_tipo: "factura" | "ticket";
  origen: string;
  fecha: string | null;
  cliente: string | null;
  ruc: string | null;
  numero: string | null;
  timbrado: string | null;
  cdc: string | null;
  condicion: string | null;
  metodo_pago: string | null;
  exento: string | number;
  gravado5: string | number;
  iva5: string | number;
  gravado10: string | number;
  iva10: string | number;
  total: string | number;
  estado: string;
  venta_id: string;
  factura_id: string | null;
}

export interface LibroVentaTotalTotals {
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  cantidad: number;
  cantidad_facturadas: number;
  cantidad_tickets: number;
  total_facturadas: number;
  total_tickets: number;
}

export interface LibroVentaTotalFilters {
  desde?: string | null;
  hasta?: string | null;
  cliente_id?: string | null;
  origen?: "factura" | "ticket" | null;
  metodo_pago?: string | null;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export async function listLibroVentasTotal(
  schemaRaw: string,
  empresaId: string,
  f: LibroVentaTotalFilters = {}
): Promise<LibroVentaTotalRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tF = quoteSchemaTable(schema, "facturas");
  const tFE = quoteSchemaTable(schema, "factura_electronica");
  const tCl = quoteSchemaTable(schema, "clientes");

  const params: unknown[] = [empresaId];
  const filters: string[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (f.desde) filters.push(`x.fecha >= ${add(f.desde)}::date`);
  if (f.hasta) filters.push(`x.fecha <= ${add(f.hasta)}::date`);
  if (f.cliente_id) filters.push(`x.cliente_id = ${add(f.cliente_id)}::uuid`);
  if (f.origen) filters.push(`x.origen_tipo = ${add(f.origen)}`);
  if (f.metodo_pago) filters.push(`x.metodo_pago = ${add(f.metodo_pago)}`);
  const whereExtra = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const sql = `
    WITH iva_por_venta AS (
      SELECT
        i.venta_id,
        SUM(CASE WHEN i.tipo_iva = 'EXENTA' THEN i.subtotal    ELSE 0 END) AS exento,
        SUM(CASE WHEN i.tipo_iva = '5%'     THEN i.subtotal    ELSE 0 END) AS gravado5,
        SUM(CASE WHEN i.tipo_iva = '5%'     THEN i.monto_iva   ELSE 0 END) AS iva5,
        SUM(CASE WHEN i.tipo_iva = '10%'    THEN i.subtotal    ELSE 0 END) AS gravado10,
        SUM(CASE WHEN i.tipo_iva = '10%'    THEN i.monto_iva   ELSE 0 END) AS iva10
      FROM ${tVI} i
      WHERE i.empresa_id = $1::uuid
      GROUP BY i.venta_id
    )
    SELECT * FROM (
      SELECT
        CASE WHEN v.factura_id IS NOT NULL THEN 'factura' ELSE 'ticket' END AS origen_tipo,
        CASE WHEN v.factura_id IS NOT NULL THEN 'Factura'  ELSE 'Ticket'  END AS origen,
        v.fecha::date AS fecha,
        COALESCE(f.cliente_razon_social, cl.nombre, 'Consumidor final') AS cliente,
        COALESCE(f.cliente_ruc, cl.ruc) AS ruc,
        COALESCE(f.numero_factura, v.numero_control) AS numero,
        NULL::text AS timbrado,
        fe.cdc AS cdc,
        v.tipo_venta AS condicion,
        v.metodo_pago AS metodo_pago,
        COALESCE(iv.exento, 0) AS exento,
        COALESCE(iv.gravado5, 0) AS gravado5,
        COALESCE(iv.iva5, 0) AS iva5,
        COALESCE(iv.gravado10, 0) AS gravado10,
        COALESCE(iv.iva10, 0) AS iva10,
        v.total AS total,
        v.estado AS estado,
        v.id AS venta_id,
        v.factura_id AS factura_id,
        v.cliente_id AS cliente_id
      FROM ${tV} v
      LEFT JOIN iva_por_venta iv ON iv.venta_id = v.id
      LEFT JOIN ${tF} f ON f.id = v.factura_id
      LEFT JOIN ${tFE} fe ON fe.factura_id = v.factura_id
      LEFT JOIN ${tCl} cl ON cl.id = v.cliente_id
      WHERE v.empresa_id = $1::uuid
        AND COALESCE(v.estado, '') <> 'anulada'
    ) x
    ${whereExtra}
    ORDER BY x.fecha DESC NULLS LAST, x.numero DESC
  `;

  const { rows } = await pool().query<LibroVentaTotalRow>(sql, params);
  return rows;
}

export function computeTotals(rows: LibroVentaTotalRow[]): LibroVentaTotalTotals {
  const t: LibroVentaTotalTotals = {
    exento: 0, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0, total: 0,
    cantidad: rows.length,
    cantidad_facturadas: 0, cantidad_tickets: 0,
    total_facturadas: 0, total_tickets: 0,
  };
  for (const r of rows) {
    const total = Number(r.total) || 0;
    t.exento    += Number(r.exento)    || 0;
    t.gravado5  += Number(r.gravado5)  || 0;
    t.iva5      += Number(r.iva5)      || 0;
    t.gravado10 += Number(r.gravado10) || 0;
    t.iva10     += Number(r.iva10)     || 0;
    t.total     += total;
    if (r.origen_tipo === "factura") { t.cantidad_facturadas++; t.total_facturadas += total; }
    else { t.cantidad_tickets++; t.total_tickets += total; }
  }
  return t;
}
