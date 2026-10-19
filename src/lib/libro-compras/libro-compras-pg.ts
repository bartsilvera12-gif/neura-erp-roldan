import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Libro de Compras — adaptado al modelo de Darocha.
 *
 * En Darocha `compras` NO tiene tabla de items separada: cada fila de compras
 * ES un ítem (multi-línea = misma numero_control repetido). Agrupamos por
 * numero_control para consolidar la factura. Excluye anuladas y compras sin
 * timbrado (borradores fiscales).
 *
 * Gastos NO se incluyen: Darocha `gastos` no tiene datos fiscales (timbrado,
 * comprobante). Si mañana se agrega, se puede unir aquí.
 */

export interface LibroCompraRow {
  origen_tipo: "compra";
  origen: string;
  fecha: string | null;
  proveedor: string | null;
  ruc: string | null;
  tipo_comprobante: string | null;
  timbrado: string | null;
  numero: string | null;
  condicion: string | null;
  exento: string | number;
  gravado5: string | number;
  iva5: string | number;
  gravado10: string | number;
  iva10: string | number;
  total: string | number;
  estado: string;
  proveedor_id: string | null;
}

export interface LibroTotals {
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  cantidad: number;
}

export interface LibroFilters {
  desde?: string | null;
  hasta?: string | null;
  proveedor_id?: string | null;
  origen?: "compra" | "gasto" | null;
  tipo_comprobante?: string | null;
  condicion?: string | null;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export async function listLibroCompras(
  schemaRaw: string,
  empresaId: string,
  f: LibroFilters = {}
): Promise<LibroCompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tCC = quoteSchemaTable(schema, "consignacion_compras");

  const params: unknown[] = [empresaId];
  const filters: string[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (f.desde) filters.push(`x.fecha >= ${add(f.desde)}::date`);
  if (f.hasta) filters.push(`x.fecha <= ${add(f.hasta)}::date`);
  if (f.proveedor_id) filters.push(`x.proveedor_id = ${add(f.proveedor_id)}::uuid`);
  if (f.condicion) filters.push(`x.condicion = ${add(f.condicion)}`);
  const whereExtra = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  // Agrupamos por numero_control (una "compra" real puede tener varias líneas).
  // Sumamos por iva_tipo. Excluimos anuladas y compras sin timbrado.
  const sql = `
    SELECT * FROM (
      SELECT
        'compra'::text AS origen_tipo,
        'Compra'::text AS origen,
        MIN(c.fecha)::date AS fecha,
        MAX(c.proveedor_nombre) AS proveedor,
        MAX(pr.ruc) AS ruc,
        'Factura'::text AS tipo_comprobante,
        MAX(c.nro_timbrado) AS timbrado,
        c.numero_control AS numero,
        MAX(c.tipo_pago) AS condicion,
        COALESCE(SUM(CASE WHEN c.iva_tipo = 'exenta' THEN c.subtotal  ELSE 0 END), 0) AS exento,
        COALESCE(SUM(CASE WHEN c.iva_tipo = '5'      THEN c.subtotal  ELSE 0 END), 0) AS gravado5,
        COALESCE(SUM(CASE WHEN c.iva_tipo = '5'      THEN c.monto_iva ELSE 0 END), 0) AS iva5,
        COALESCE(SUM(CASE WHEN c.iva_tipo = '10'     THEN c.subtotal  ELSE 0 END), 0) AS gravado10,
        COALESCE(SUM(CASE WHEN c.iva_tipo = '10'     THEN c.monto_iva ELSE 0 END), 0) AS iva10,
        SUM(c.total) AS total,
        MIN(c.estado) AS estado,
        c.proveedor_id AS proveedor_id
      FROM ${tC} c
      LEFT JOIN ${tPr} pr ON pr.id = c.proveedor_id
      WHERE c.empresa_id = $1::uuid
        AND COALESCE(c.estado, '') <> 'anulada'
        AND c.nro_timbrado IS NOT NULL
        AND btrim(c.nro_timbrado) <> ''
      GROUP BY c.numero_control, c.proveedor_id

      UNION ALL

      -- Compras de la CONSIGNATARIA (concepto libre, sin inventario). Mismo formato
      -- fiscal: se listan solo las que tienen timbrado (factura real del proveedor).
      SELECT
        'compra'::text AS origen_tipo,
        'Consignataria'::text AS origen,
        MIN(cc.fecha)::date AS fecha,
        MAX(cc.proveedor_nombre) AS proveedor,
        MAX(cc.proveedor_ruc) AS ruc,
        'Factura'::text AS tipo_comprobante,
        MAX(cc.nro_timbrado) AS timbrado,
        cc.numero_control AS numero,
        MAX(cc.tipo_pago) AS condicion,
        COALESCE(SUM(CASE WHEN cc.iva_tipo = 'exenta' THEN cc.subtotal  ELSE 0 END), 0) AS exento,
        COALESCE(SUM(CASE WHEN cc.iva_tipo = '5'      THEN cc.subtotal  ELSE 0 END), 0) AS gravado5,
        COALESCE(SUM(CASE WHEN cc.iva_tipo = '5'      THEN cc.monto_iva ELSE 0 END), 0) AS iva5,
        COALESCE(SUM(CASE WHEN cc.iva_tipo = '10'     THEN cc.subtotal  ELSE 0 END), 0) AS gravado10,
        COALESCE(SUM(CASE WHEN cc.iva_tipo = '10'     THEN cc.monto_iva ELSE 0 END), 0) AS iva10,
        SUM(cc.monto_total) AS total,
        MIN(cc.estado) AS estado,
        NULL::uuid AS proveedor_id
      FROM ${tCC} cc
      WHERE cc.empresa_id = $1::uuid
        AND COALESCE(cc.estado, '') <> 'anulada'
        AND cc.nro_timbrado IS NOT NULL
        AND btrim(cc.nro_timbrado) <> ''
      GROUP BY cc.numero_control
    ) x
    ${whereExtra}
    ORDER BY x.fecha DESC NULLS LAST, x.numero DESC
  `;

  const { rows } = await pool().query<LibroCompraRow>(sql, params);
  return rows;
}

export function computeTotals(rows: LibroCompraRow[]): LibroTotals {
  const t: LibroTotals = { exento: 0, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0, total: 0, cantidad: rows.length };
  for (const r of rows) {
    t.exento += Number(r.exento) || 0;
    t.gravado5 += Number(r.gravado5) || 0;
    t.iva5 += Number(r.iva5) || 0;
    t.gravado10 += Number(r.gravado10) || 0;
    t.iva10 += Number(r.iva10) || 0;
    t.total += Number(r.total) || 0;
  }
  return t;
}
