import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Historial de ventas: un año completo, mes por mes (pedido del cliente).
 *
 * Se resume en la base y no en el navegador: un año son miles de ventas y
 * decenas de miles de líneas, y lo que se quiere ver son los totales.
 *
 * ── LA UTILIDAD ──────────────────────────────────────────────────────────────
 *   La misma cuenta que el punto de equilibrio (`margenDeVenta`): lo vendido
 *   sin IVA menos el costo sin IVA, con el costo promedio de HOY de cada
 *   artículo (las ventas no guardan el costo de la línea). Las líneas de
 *   artículos sin costo cargado no entran: contarlas a costo cero inflaría la
 *   utilidad. Las anuladas no cuentan en nada.
 */

export interface MesVentas {
  mes: number; // 1..12
  ventas: number;
  anuladas: number;
  total: number;
  neto: number;
  contado: number;
  credito: number;
  descuento: number;
  unidades: number;
  ticket: number;
  /** Solo con costos. */
  costo?: number;
  utilidad?: number;
  margen_pct?: number | null;
}

export interface VentasAnual {
  anio: number;
  meses: MesVentas[];
  totales: Omit<MesVentas, "mes">;
  porTipoPrecio: Array<{ tipo_precio: string; items: number; total: number }>;
  porProducto: Array<{ producto_nombre: string; cantidad: number; total: number; utilidad?: number }>;
  porVendedor: Array<{ vendedor: string; ventas: number; total: number; utilidad?: number }>;
  conCostos: boolean;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** El IVA de la línea (o el del artículo), como divisor. */
const DIV_SQL = `(CASE COALESCE(NULLIF(vi.tipo_iva,''), p.tipo_iva, '10%') WHEN '10%' THEN 1.1 WHEN '5%' THEN 1.05 ELSE 1 END)`;
/** Mes en hora de Paraguay (UTC−3 todo el año). */
const MES_SQL = `EXTRACT(MONTH FROM (v.fecha AT TIME ZONE 'UTC') - interval '3 hours')::int`;

export async function getVentasAnual(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  anio: number,
  conCostos: boolean
): Promise<VentasAnual> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const SUC_V = andSucursal(sucursalId, "v.");
  const desde = `${anio}-01-01T00:00:00-03:00`;
  const hasta = `${anio + 1}-01-01T00:00:00-03:00`;
  const per = `v.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<$3::timestamptz`;
  const activas = `${per} AND COALESCE(v.estado,'completada') <> 'anulada'`;
  const args = [empresaId, desde, hasta];

  // Lo neto de la línea (sin IVA) y su costo sin IVA, solo si tiene costo.
  const NETO = `(vi.total_linea - COALESCE(vi.monto_iva,0))`;
  const CON_COSTO = `COALESCE(p.costo_promedio,0) > 0`;
  const lineasJoin = `${tVI} vi JOIN ${tV} v ON v.id=vi.venta_id LEFT JOIN ${tP} p ON p.id=vi.producto_id`;

  const [cab, lin, tp, prod, vend] = await Promise.all([
    p.query<Record<string, unknown>>(
      `SELECT ${MES_SQL} AS mes,
              count(*) FILTER (WHERE COALESCE(v.estado,'completada') <> 'anulada')::int AS ventas,
              count(*) FILTER (WHERE v.estado = 'anulada')::int AS anuladas,
              COALESCE(SUM(v.total) FILTER (WHERE COALESCE(v.estado,'completada') <> 'anulada'),0)::float8 AS total,
              COALESCE(SUM(v.subtotal) FILTER (WHERE COALESCE(v.estado,'completada') <> 'anulada'),0)::float8 AS neto,
              COALESCE(SUM(v.total) FILTER (WHERE COALESCE(v.estado,'completada') <> 'anulada' AND v.tipo_venta = 'CREDITO'),0)::float8 AS credito
         FROM ${tV} v WHERE ${per} GROUP BY 1`, args),
    p.query<Record<string, unknown>>(
      `SELECT ${MES_SQL} AS mes,
              COALESCE(SUM(vi.cantidad),0)::float8 AS unidades,
              COALESCE(SUM(GREATEST(COALESCE(vi.precio_venta_original,0) - vi.precio_venta, 0) * vi.cantidad),0)::float8 AS descuento,
              COALESCE(SUM(vi.cantidad * p.costo_promedio) FILTER (WHERE ${CON_COSTO}),0)::float8 AS costo,
              COALESCE(SUM(${NETO}) FILTER (WHERE ${CON_COSTO}),0)::float8 AS neto_con_costo,
              COALESCE(SUM(vi.total_linea) FILTER (WHERE ${CON_COSTO}),0)::float8 AS vendido_con_costo,
              COALESCE(SUM(vi.cantidad * p.costo_promedio / ${DIV_SQL}) FILTER (WHERE ${CON_COSTO}),0)::float8 AS cmv
         FROM ${lineasJoin} WHERE ${activas} GROUP BY 1`, args),
    p.query<Record<string, unknown>>(
      `SELECT COALESCE(NULLIF(vi.tipo_precio,''),'minorista') AS tipo_precio, count(*)::int AS items,
              COALESCE(SUM(vi.total_linea),0)::float8 AS total
         FROM ${lineasJoin} WHERE ${activas} GROUP BY 1 ORDER BY 3 DESC`, args),
    p.query<Record<string, unknown>>(
      `SELECT vi.producto_nombre, SUM(vi.cantidad)::float8 AS cantidad, SUM(vi.total_linea)::float8 AS total,
              (COALESCE(SUM(${NETO}) FILTER (WHERE ${CON_COSTO}),0)
                - COALESCE(SUM(vi.cantidad * p.costo_promedio / ${DIV_SQL}) FILTER (WHERE ${CON_COSTO}),0))::float8 AS utilidad
         FROM ${lineasJoin} WHERE ${activas}
        GROUP BY vi.producto_id, vi.producto_nombre ORDER BY 3 DESC LIMIT 50`, args),
    p.query<Record<string, unknown>>(
      `SELECT COALESCE(NULLIF(v.vendedor_nombre,''), NULLIF(v.usuario_nombre,''), 'Sin vendedor') AS vendedor,
              count(DISTINCT v.id)::int AS ventas, COALESCE(SUM(vi.total_linea),0)::float8 AS total,
              (COALESCE(SUM(${NETO}) FILTER (WHERE ${CON_COSTO}),0)
                - COALESCE(SUM(vi.cantidad * p.costo_promedio / ${DIV_SQL}) FILTER (WHERE ${CON_COSTO}),0))::float8 AS utilidad
         FROM ${lineasJoin} WHERE ${activas} GROUP BY 1 ORDER BY 3 DESC`, args),
  ]);

  const porMesLin = new Map<number, Record<string, unknown>>();
  for (const r of lin.rows) porMesLin.set(num(r.mes), r);
  const porMesCab = new Map<number, Record<string, unknown>>();
  for (const r of cab.rows) porMesCab.set(num(r.mes), r);

  const armar = (c: Record<string, unknown> | undefined, l: Record<string, unknown> | undefined): Omit<MesVentas, "mes"> => {
    const ventas = num(c?.ventas), total = num(c?.total), credito = num(c?.credito);
    const base: Omit<MesVentas, "mes"> = {
      ventas, anuladas: num(c?.anuladas), total, neto: num(c?.neto), contado: total - credito, credito,
      descuento: num(l?.descuento), unidades: num(l?.unidades), ticket: ventas > 0 ? total / ventas : 0,
    };
    if (!conCostos) return base;
    const netoCC = num(l?.neto_con_costo), cmv = num(l?.cmv);
    const utilidad = netoCC - cmv;
    // El porcentaje es sobre lo vendido con IVA, igual que en el punto de equilibrio.
    const vendidoCC = num(l?.vendido_con_costo);
    return { ...base, costo: num(l?.costo), utilidad, margen_pct: vendidoCC > 0 ? (utilidad / vendidoCC) * 100 : null };
  };

  const meses: MesVentas[] = [];
  for (let m = 1; m <= 12; m++) meses.push({ mes: m, ...armar(porMesCab.get(m), porMesLin.get(m)) });

  const sumar = (k: keyof MesVentas) => meses.reduce((s, m) => s + num(m[k]), 0);
  const tVentas = sumar("ventas"), tTotal = sumar("total");
  const totales: Omit<MesVentas, "mes"> = {
    ventas: tVentas, anuladas: sumar("anuladas"), total: tTotal, neto: sumar("neto"),
    contado: sumar("contado"), credito: sumar("credito"), descuento: sumar("descuento"), unidades: sumar("unidades"),
    ticket: tVentas > 0 ? tTotal / tVentas : 0,
  };
  if (conCostos) {
    const utilidad = sumar("utilidad");
    totales.costo = sumar("costo");
    totales.utilidad = utilidad;
    totales.margen_pct = tTotal > 0 ? (utilidad / tTotal) * 100 : null;
  }

  return {
    anio,
    meses,
    totales,
    porTipoPrecio: tp.rows.map((r) => ({ tipo_precio: String(r.tipo_precio), items: num(r.items), total: num(r.total) })),
    porProducto: prod.rows.map((r) => ({
      producto_nombre: String(r.producto_nombre ?? ""), cantidad: num(r.cantidad), total: num(r.total),
      ...(conCostos ? { utilidad: num(r.utilidad) } : {}),
    })),
    porVendedor: vend.rows.map((r) => ({
      vendedor: String(r.vendedor ?? ""), ventas: num(r.ventas), total: num(r.total),
      ...(conCostos ? { utilidad: num(r.utilidad) } : {}),
    })),
    conCostos,
  };
}
