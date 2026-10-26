import { andSucursal } from "@/lib/sucursales/sql";
/**
 * Agregados SQL server-side para el módulo Reportes (schema roldanerp).
 * Fase 1: Estado de cuenta + Proveedores. Solo lectura sobre
 * ventas / compras / gastos / proveedores. Mismo patrón de pool que compras-pg.
 *
 * `start`/`end` = límites timestamptz del mes (para ventas/compras, fecha tz).
 * `mesInicio` = "YYYY-MM-01" (para gastos.fecha que es DATE).
 *
 * NOTA — modelo de compras de Reserva (PLANO): una compra multiproducto son N
 * filas en `compras` que comparten `numero_control` (no hay tabla `compras_items`).
 * Por eso, para contar "compras" reales se agrupa/cuenta por `numero_control`,
 * mientras que los SUM(total) ya son correctos (suman los totales de línea).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type {
  EstadoCuentaReporte,
  MovimientoEstadoCuenta,
  ProveedoresReporte,
  ProveedorReporteRow,
  ComprasReporte,
  CompraReporteRow,
  ItemCompradoRow,
  CompraProveedorTotal,
  CompraProductoTotal,
  VentasReporte,
  VentaReporteRow,
  ItemVendidoRow,
  VentaProductoTotal,
  TipoPrecioReporte,
  ConciliacionReporte,
  ConciliacionAgrupado,
  ConciliacionMovRow,
} from "@/lib/reportes/types";
import type { GananciasPeriodo } from "@/lib/reportes/ganancias-types";
import type { RentabilidadRow, AgruparRentabilidad } from "@/lib/reportes/rentabilidad-types";
import type { MovimientoCaja } from "@/lib/reportes/flujo-caja-types";
import type { TesoreriaRow } from "@/lib/reportes/tesoreria-types";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface MesBounds {
  mes: string;
  start: string;
  end: string;
  mesInicio: string; // YYYY-MM-01
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

// ── Estado de cuenta ─────────────────────────────────────────────────────────

export async function getEstadoCuenta(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: MesBounds
): Promise<EstadoCuentaReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tVentas = quoteSchemaTable(schema, "ventas");
  const tCompras = quoteSchemaTable(schema, "compras");
  const tGastos = quoteSchemaTable(schema, "gastos");
  const p = pool();

  const ventasQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(total),0)::float8 AS total FROM ${tVentas}
      WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz`,
    [empresaId, b.start, b.end]
  );
  const comprasQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(total),0)::float8 AS total FROM ${tCompras}
      WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz`,
    [empresaId, b.start, b.end]
  );
  const gastosQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(monto),0)::float8 AS total FROM ${tGastos}
      WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::date AND fecha < ($2::date + interval '1 month')`,
    [empresaId, b.mesInicio]
  );
  // Por cobrar / por pagar = SALDO PENDIENTE REAL A LA FECHA (no "generado en el
  // período"). Descuenta cobros parciales y notas de crédito, para que el número
  // represente exactamente lo que todavía falta cobrar/pagar.
  //
  // CxC: cuentas_por_cobrar.saldo (se decrementa en cada cobro) con estado
  // pendiente|parcial. Es un saldo puntual, no filtrado por el mes seleccionado.
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const porCobrarQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(saldo),0)::float8 AS total FROM ${tCxc}
      WHERE empresa_id=$1::uuid${SUC} AND estado IN ('pendiente','parcial')`,
    [empresaId]
  );
  // CxP: compras a crédito no pagadas/anuladas, agrupadas por numero_control,
  // menos notas de crédito de compra (piso 0 por compra). Si la tabla de NC no
  // existe todavía, cae al bruto sin romper.
  const tNcc = quoteSchemaTable(schema, "notas_credito_compra");
  const cxpBase =
    `SELECT numero_control, SUM(total) AS bruto FROM ${tCompras} c
      WHERE c.empresa_id=$1::uuid${SUC_C} AND c.tipo_pago='credito'
        AND COALESCE(c.estado,'registrada') NOT IN ('pagada','anulada')
      GROUP BY numero_control`;
  const porPagarQ = p
    .query<{ total: number }>(
      `WITH cc AS (${cxpBase}),
            nc AS (SELECT compra_numero_control, SUM(monto) AS nc FROM ${tNcc}
                    WHERE empresa_id=$1::uuid GROUP BY compra_numero_control)
       SELECT COALESCE(SUM(GREATEST(cc.bruto - COALESCE(nc.nc,0),0)),0)::float8 AS total
         FROM cc LEFT JOIN nc ON nc.compra_numero_control = cc.numero_control`,
      [empresaId]
    )
    .catch(() =>
      p.query<{ total: number }>(
        `SELECT COALESCE(SUM(bruto),0)::float8 AS total FROM (${cxpBase}) s`,
        [empresaId]
      )
    );
  // Compras agrupadas por numero_control (modelo plano): una fila por compra real.
  const movsQ = p.query<MovimientoEstadoCuenta>(
    `SELECT fecha, tipo, referencia, descripcion, entrada, salida FROM (
        SELECT fecha, 'Venta'::text AS tipo, numero_control AS referencia,
               'Venta a cliente'::text AS descripcion, total::float8 AS entrada, 0::float8 AS salida
          FROM ${tVentas}
         WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz
        UNION ALL
        SELECT MIN(fecha) AS fecha, 'Compra'::text, numero_control,
               MIN(proveedor_nombre), 0::float8, SUM(total)::float8
          FROM ${tCompras}
         WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz
         GROUP BY numero_control
        UNION ALL
        SELECT fecha::timestamptz, 'Gasto'::text, COALESCE(categoria,''),
               COALESCE(descripcion,''), 0::float8, monto::float8
          FROM ${tGastos}
         WHERE empresa_id=$1::uuid${SUC} AND fecha>=$4::date AND fecha < ($4::date + interval '1 month')
      ) m ORDER BY fecha ASC`,
    [empresaId, b.start, b.end, b.mesInicio]
  );

  const [ventas, compras, gastos, porCobrar, porPagar, movs] = await Promise.all([
    ventasQ, comprasQ, gastosQ, porCobrarQ, porPagarQ, movsQ,
  ]);

  const ingresosVentas = num(ventas.rows[0]?.total);
  const comprasTotal = num(compras.rows[0]?.total);
  const gastosTotal = num(gastos.rows[0]?.total);

  return {
    mes: b.mes,
    ingresosVentas,
    compras: comprasTotal,
    gastos: gastosTotal,
    resultado: ingresosVentas - comprasTotal - gastosTotal,
    porCobrar: num(porCobrar.rows[0]?.total),
    porPagar: num(porPagar.rows[0]?.total),
    movimientos: movs.rows.map((m) => ({
      fecha: m.fecha,
      tipo: m.tipo,
      referencia: m.referencia,
      descripcion: m.descripcion,
      entrada: num(m.entrada),
      salida: num(m.salida),
    })),
  };
}

// ── Proveedores ──────────────────────────────────────────────────────────────

export async function getReporteProveedores(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: MesBounds
): Promise<ProveedoresReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tProv = quoteSchemaTable(schema, "proveedores");
  const tC = quoteSchemaTable(schema, "compras");
  const p = pool();

  const totalProvQ = p.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${tProv} WHERE empresa_id=$1::uuid`, [empresaId]);  // proveedores es COMPARTIDO entre sucursales: no lleva sucursal_id
  const mesQ = p.query<{ proveedores: number; total: number }>(
    `SELECT count(DISTINCT proveedor_id)::int AS proveedores, COALESCE(SUM(total),0)::float8 AS total
       FROM ${tC} WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz`,
    [empresaId, b.start, b.end]);
  // Última compra: total de la compra agrupada por numero_control (modelo plano).
  const ultimaQ = p.query<{ numero_control: string; proveedor_nombre: string; total: number; fecha: string }>(
    `SELECT numero_control, MIN(proveedor_nombre) AS proveedor_nombre,
            SUM(total)::float8 AS total, MAX(fecha) AS fecha
       FROM ${tC} WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz
      GROUP BY numero_control
      ORDER BY MAX(fecha) DESC LIMIT 1`, [empresaId, b.start, b.end]);
  // Proveedores con sus métricas del mes (LEFT JOIN para incluir los sin compras).
  // `cantidad` = compras reales (numero_control distintos), no líneas.
  const provListQ = p.query<ProveedorReporteRow>(
    `SELECT pr.id, pr.nombre, pr.ruc, pr.telefono,
            COALESCE(cc.cantidad,0)::int AS cantidad,
            COALESCE(cc.total,0)::float8 AS total,
            cc.ultima_compra
       FROM ${tProv} pr
       LEFT JOIN (
         SELECT proveedor_id,
                count(DISTINCT numero_control)::int AS cantidad,
                SUM(total)::float8 AS total,
                MAX(fecha) AS ultima_compra
           FROM ${tC} WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz
          GROUP BY proveedor_id
       ) cc ON cc.proveedor_id = pr.id
      WHERE pr.empresa_id=$1::uuid
      ORDER BY COALESCE(cc.total,0) DESC, pr.nombre ASC`,
    [empresaId, b.start, b.end]);

  const [totalProv, mes, ultima, provList] = await Promise.all([totalProvQ, mesQ, ultimaQ, provListQ]);

  const conCompras = num(mes.rows[0]?.proveedores);
  const totalComprado = num(mes.rows[0]?.total);

  // Notas de crédito de compra imputadas a compras del mes, por proveedor
  // (devoluciones/bonificaciones del proveedor). Best-effort: si la tabla no
  // existe todavía, se ignora sin romper el reporte. Se atribuye la NC al
  // proveedor de la compra a la que fue imputada, contando solo compras del mes.
  const tNCC = quoteSchemaTable(schema, "notas_credito_compra");
  const ncByProv = new Map<string, number>();
  try {
    const ncRes = await p.query<{ proveedor_id: string; nc: number }>(
      `SELECT c.proveedor_id, COALESCE(SUM(ncc.monto),0)::float8 AS nc
         FROM ${tNCC} ncc
         JOIN (SELECT DISTINCT numero_control, proveedor_id FROM ${tC}
                WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz) c
           ON c.numero_control = ncc.compra_numero_control
        WHERE ncc.empresa_id=$1::uuid
        GROUP BY c.proveedor_id`,
      [empresaId, b.start, b.end]);
    for (const r of ncRes.rows) ncByProv.set(String(r.proveedor_id), num(r.nc));
  } catch {
    /* tabla notas_credito_compra inexistente todavía */
  }
  const totalNC = [...ncByProv.values()].reduce((a, v) => a + v, 0);

  return {
    mes: b.mes,
    totalProveedores: num(totalProv.rows[0]?.n),
    conCompras,
    totalComprado,
    totalNC,
    totalNeto: Math.max(0, totalComprado - totalNC),
    compraPromedio: conCompras > 0 ? totalComprado / conCompras : 0,
    ultimaCompra: ultima.rows[0] ? { ...ultima.rows[0], total: num(ultima.rows[0].total) } : null,
    proveedores: provList.rows.map((r) => {
      const total = num(r.total);
      const nc = ncByProv.get(String(r.id)) ?? 0;
      return { ...r, cantidad: num(r.cantidad), total, nc, neto: Math.max(0, total - nc) };
    }),
  };
}

// ── Compras (modelo PLANO: N filas en `compras` por numero_control) ───────────

export async function getReporteCompras(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: MesBounds
): Promise<ComprasReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tC = quoteSchemaTable(schema, "compras");
  const p = pool();
  const per = `c.empresa_id=$1::uuid${SUC_C} AND c.fecha>=$2::timestamptz AND c.fecha<=$3::timestamptz`;
  // Las compras ANULADAS no cuentan en los agregados. Sí se listan en el detalle
  // con badge en la UI para trazabilidad.
  const perActivas = `${per} AND COALESCE(c.estado,'registrada') <> 'anulada'`;
  const args = [empresaId, b.start, b.end];

  const totQ = p.query<{ compras: number; items: number; total: number }>(
    `SELECT count(DISTINCT numero_control)::int AS compras, count(*)::int AS items,
            COALESCE(SUM(total),0)::float8 AS total
       FROM ${tC} c WHERE ${perActivas}`, args);
  const masAltaQ = p.query<{ numero_control: string; proveedor_nombre: string; total: number }>(
    `SELECT numero_control, MIN(proveedor_nombre) AS proveedor_nombre, SUM(total)::float8 AS total
       FROM ${tC} c WHERE ${perActivas} GROUP BY numero_control ORDER BY total DESC LIMIT 1`, args);
  const provMayorQ = p.query<{ proveedor_nombre: string; total: number }>(
    `SELECT proveedor_nombre, SUM(total)::float8 AS total FROM ${tC} c WHERE ${perActivas}
      GROUP BY proveedor_id, proveedor_nombre ORDER BY total DESC LIMIT 1`, args);
  const prodCantQ = p.query<{ producto_nombre: string; cantidad: number }>(
    `SELECT producto_nombre, SUM(cantidad)::float8 AS cantidad FROM ${tC} c WHERE ${perActivas}
      GROUP BY producto_id, producto_nombre ORDER BY cantidad DESC LIMIT 1`, args);
  const prodGastoQ = p.query<{ producto_nombre: string; gasto: number }>(
    `SELECT producto_nombre, SUM(total)::float8 AS gasto FROM ${tC} c WHERE ${perActivas}
      GROUP BY producto_id, producto_nombre ORDER BY gasto DESC LIMIT 1`, args);
  const porProvQ = p.query<CompraProveedorTotal>(
    `SELECT proveedor_nombre, count(DISTINCT numero_control)::int AS compras, SUM(total)::float8 AS total
       FROM ${tC} c WHERE ${perActivas} GROUP BY proveedor_id, proveedor_nombre ORDER BY total DESC`, args);
  const porProdQ = p.query<CompraProductoTotal>(
    `SELECT producto_nombre, SUM(cantidad)::float8 AS cantidad, SUM(total)::float8 AS gasto
       FROM ${tC} c WHERE ${perActivas} GROUP BY producto_id, producto_nombre ORDER BY gasto DESC`, args);
  // Detalle por compra: SÍ incluye anuladas para trazabilidad; estado + datos de
  // anulación (fecha, motivo, email del usuario que anuló) van en la respuesta.
  const comprasQ = p.query<CompraReporteRow>(
    `SELECT c.numero_control, MIN(c.fecha) AS fecha, MIN(c.proveedor_nombre) AS proveedor_nombre,
            count(*)::int AS items_count, SUM(c.subtotal)::float8 AS subtotal,
            SUM(c.monto_iva)::float8 AS monto_iva, SUM(c.total)::float8 AS total,
            MIN(c.tipo_pago) AS tipo_pago, MIN(c.nro_timbrado) AS nro_timbrado,
            bool_or(c.comprobante_storage_path IS NOT NULL) AS tiene_comprobante,
            MIN(COALESCE(c.estado,'registrada')) AS estado,
            MAX(c.anulada_at) AS anulada_at,
            MAX(c.anulacion_motivo) AS anulacion_motivo,
            MAX(au.email) AS anulada_por_email,
            string_agg(c.producto_nombre || ' x' || c.cantidad, ', ' ORDER BY c.producto_nombre) AS productos_resumen
       FROM ${tC} c
       LEFT JOIN auth.users au ON au.id = c.anulada_por
      WHERE ${per}
      GROUP BY c.numero_control ORDER BY MIN(c.fecha) DESC, c.numero_control DESC`, args);
  // Detalle por línea: excluye anuladas (no compraron nada realmente).
  const itemsQ = p.query<ItemCompradoRow>(
    `SELECT numero_control, fecha, proveedor_nombre, producto_nombre,
            cantidad::float8 AS cantidad, costo_unitario::float8 AS costo_unitario,
            total::float8 AS total_linea
       FROM ${tC} c WHERE ${perActivas} ORDER BY fecha DESC, numero_control DESC`, args);

  const [tot, masAlta, provMayor, prodCant, prodGasto, porProv, porProd, compras, items] =
    await Promise.all([totQ, masAltaQ, provMayorQ, prodCantQ, prodGastoQ, porProvQ, porProdQ, comprasQ, itemsQ]);

  return {
    mes: b.mes,
    totalComprado: num(tot.rows[0]?.total),
    cantidad: num(tot.rows[0]?.compras),
    cantidadItems: num(tot.rows[0]?.items),
    compraMasAlta: masAlta.rows[0]
      ? { numero_control: masAlta.rows[0].numero_control, proveedor_nombre: masAlta.rows[0].proveedor_nombre, total: num(masAlta.rows[0].total) }
      : null,
    proveedorMayor: provMayor.rows[0] ? { proveedor_nombre: provMayor.rows[0].proveedor_nombre, total: num(provMayor.rows[0].total) } : null,
    productoMasComprado: prodCant.rows[0] ? { producto_nombre: prodCant.rows[0].producto_nombre, cantidad: num(prodCant.rows[0].cantidad) } : null,
    productoMayorGasto: prodGasto.rows[0] ? { producto_nombre: prodGasto.rows[0].producto_nombre, gasto: num(prodGasto.rows[0].gasto) } : null,
    porProveedor: porProv.rows.map((r) => ({ ...r, compras: num(r.compras), total: num(r.total) })),
    porProducto: porProd.rows.map((r) => ({ ...r, cantidad: num(r.cantidad), gasto: num(r.gasto) })),
    compras: compras.rows.map((c) => ({
      ...c,
      items_count: num(c.items_count),
      subtotal: num(c.subtotal),
      monto_iva: num(c.monto_iva),
      total: num(c.total),
      nro_timbrado: c.nro_timbrado || null,
      tiene_comprobante: c.tiene_comprobante === true,
      estado: (c.estado === "anulada" || c.estado === "pendiente" || c.estado === "pagada"
        ? c.estado
        : "registrada") as "registrada" | "pendiente" | "pagada" | "anulada",
      anulada_at: c.anulada_at ?? null,
      anulacion_motivo: c.anulacion_motivo ?? null,
      anulada_por_email: c.anulada_por_email ?? null,
      productos_resumen: c.productos_resumen ?? null,
    })),
    items: items.rows.map((i) => ({
      ...i,
      cantidad: num(i.cantidad),
      costo_unitario: num(i.costo_unitario),
      total_linea: num(i.total_linea),
    })),
  };
}

// ── Ventas (cabecera `ventas` + líneas `ventas_items`, desglose por tipo_precio) ─

/** Normaliza tipo_precio (null/'' → minorista). */
const TP_SQL = `COALESCE(NULLIF(vi.tipo_precio,''),'minorista')`;
function normTipoPrecio(v: unknown): TipoPrecioReporte {
  return v === "mayorista" || v === "distribuidor" || v === "costo" ? v : "minorista";
}

export async function getReporteVentas(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: MesBounds
): Promise<VentasReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tCli = quoteSchemaTable(schema, "clientes");
  const p = pool();
  const perV = `v.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz`;
  // Las ventas ANULADAS no cuentan en los agregados (totales, ítems, unidades, por producto,
  // por tipo de precio). Sí se listan en el detalle para trazabilidad, con badge en la UI.
  const perVActivas = `${perV} AND COALESCE(v.estado,'completada') <> 'anulada'`;
  const args = [empresaId, b.start, b.end];

  // Totales de cabecera (excluye anuladas).
  const totQ = p.query<{ ventas: number; total: number }>(
    `SELECT count(*)::int AS ventas, COALESCE(SUM(total),0)::float8 AS total
       FROM ${tV} v WHERE ${perVActivas}`, args);
  // Ítems / unidades (excluye anuladas).
  const itemsTotQ = p.query<{ items: number; unidades: number }>(
    `SELECT count(*)::int AS items, COALESCE(SUM(vi.cantidad),0)::float8 AS unidades
       FROM ${tVI} vi JOIN ${tV} v ON v.id=vi.venta_id WHERE ${perVActivas}`, args);
  // Desglose por tipo_precio (excluye anuladas).
  const tipoPrecioQ = p.query<{ tipo_precio: string; items: number; total: number }>(
    `SELECT ${TP_SQL} AS tipo_precio, count(*)::int AS items, COALESCE(SUM(vi.total_linea),0)::float8 AS total
       FROM ${tVI} vi JOIN ${tV} v ON v.id=vi.venta_id WHERE ${perVActivas}
      GROUP BY ${TP_SQL}`, args);
  // Total por producto (excluye anuladas).
  const porProdQ = p.query<VentaProductoTotal>(
    `SELECT vi.producto_nombre, SUM(vi.cantidad)::float8 AS cantidad, SUM(vi.total_linea)::float8 AS total
       FROM ${tVI} vi JOIN ${tV} v ON v.id=vi.venta_id WHERE ${perVActivas}
      GROUP BY vi.producto_id, vi.producto_nombre ORDER BY total DESC`, args);
  // Detalle de ventas: SÍ incluye anuladas para trazabilidad; el estado + datos de
  // anulación (fecha, motivo, email del usuario que anuló) + resumen de productos van en la respuesta.
  const ventasQ = p.query<VentaReporteRow>(
    `SELECT v.id, v.numero_control, v.fecha, c.nombre AS cliente, v.metodo_pago,
            (SELECT count(*) FROM ${tVI} vi WHERE vi.venta_id=v.id)::int AS items_count,
            v.total::float8 AS total,
            COALESCE(v.estado,'completada') AS estado,
            v.anulada_at, v.anulacion_motivo, au.email AS anulada_por_email,
            (SELECT string_agg(vi.producto_nombre || ' x' || vi.cantidad, ', ' ORDER BY vi.producto_nombre)
               FROM ${tVI} vi WHERE vi.venta_id = v.id) AS productos_resumen
       FROM ${tV} v
       LEFT JOIN ${tCli} c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id
       LEFT JOIN auth.users au ON au.id = v.anulada_por
      WHERE ${perV} ORDER BY v.fecha DESC, v.numero_control DESC`, args);
  // Detalle por línea (excluye anuladas — no vendieron nada realmente).
  const itemsQ = p.query<ItemVendidoRow>(
    `SELECT v.numero_control, v.fecha, vi.producto_nombre,
            vi.cantidad::float8 AS cantidad, vi.precio_venta::float8 AS precio_venta,
            vi.subtotal::float8 AS subtotal, vi.monto_iva::float8 AS monto_iva,
            vi.total_linea::float8 AS total_linea, ${TP_SQL} AS tipo_precio
       FROM ${tVI} vi JOIN ${tV} v ON v.id=vi.venta_id WHERE ${perVActivas}
      ORDER BY v.fecha DESC, v.numero_control DESC`, args);

  const [tot, itemsTot, tipoPrecio, porProd, ventas, items] = await Promise.all([
    totQ, itemsTotQ, tipoPrecioQ, porProdQ, ventasQ, itemsQ]);

  const cantidadVentas = num(tot.rows[0]?.ventas);
  const totalVendido = num(tot.rows[0]?.total);
  const porTipoPrecio: Record<TipoPrecioReporte, { items: number; total: number }> = {
    minorista: { items: 0, total: 0 },
    mayorista: { items: 0, total: 0 },
    distribuidor: { items: 0, total: 0 },
    costo: { items: 0, total: 0 },
  };
  for (const r of tipoPrecio.rows) {
    porTipoPrecio[normTipoPrecio(r.tipo_precio)] = { items: num(r.items), total: num(r.total) };
  }

  return {
    mes: b.mes,
    totalVendido,
    cantidadVentas,
    cantidadItems: num(itemsTot.rows[0]?.items),
    ticketPromedio: cantidadVentas > 0 ? totalVendido / cantidadVentas : 0,
    unidadesVendidas: num(itemsTot.rows[0]?.unidades),
    porTipoPrecio,
    porProducto: porProd.rows.map((r) => ({ ...r, cantidad: num(r.cantidad), total: num(r.total) })),
    ventas: ventas.rows.map((v) => ({
      ...v,
      cliente: v.cliente || null,
      metodo_pago: v.metodo_pago || null,
      items_count: num(v.items_count),
      total: num(v.total),
      estado: (v.estado === "anulada" || v.estado === "pendiente" ? v.estado : "completada") as "pendiente" | "completada" | "anulada",
      anulada_at: v.anulada_at ?? null,
      anulacion_motivo: v.anulacion_motivo ?? null,
      anulada_por_email: v.anulada_por_email ?? null,
      productos_resumen: v.productos_resumen ?? null,
    })),
    items: items.rows.map((i) => ({
      ...i,
      cantidad: num(i.cantidad),
      precio_venta: num(i.precio_venta),
      subtotal: num(i.subtotal),
      monto_iva: num(i.monto_iva),
      total_linea: num(i.total_linea),
      tipo_precio: normTipoPrecio(i.tipo_precio),
    })),
  };
}

// ── Conciliación bancaria (ventas del mes + detalle de cobro) ─────────────────

export async function getReporteConciliacion(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: MesBounds
): Promise<ConciliacionReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tD = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tCob = quoteSchemaTable(schema, "cobros_clientes");
  const tCli = quoteSchemaTable(schema, "clientes");
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tEnt = quoteSchemaTable(schema, "entidades_bancarias");
  const p = pool();
  const args = [empresaId, b.start, b.end];

  // Conciliación = SOLO movimientos bancarios (no efectivo): no hay nada que conciliar
  // en efectivo. Incluye el cobro de ventas contado (ventas_pagos_detalle) y los cobros
  // de cuentas por cobrar (cobros_clientes). El efectivo se excluye en todos lados.
  // Cada movimiento trae su estado de conciliación (pendiente|aprobado|rechazado).
  const movsCTE = `WITH movs AS (
      SELECT d.id::text AS id, 'venta'::text AS tipo, v.fecha AS fecha,
             v.numero_control AS numero, c.nombre AS cliente, d.metodo_pago AS metodo,
             COALESCE(NULLIF(d.entidad_nombre_snapshot,''),'(sin entidad)') AS entidad,
             eb.codigo AS entidad_codigo,
             d.referencia AS referencia, d.titular AS titular, d.monto::float8 AS monto,
             d.conciliacion_estado AS estado
        FROM ${tD} d
        JOIN ${tV} v ON v.id=d.venta_id AND v.empresa_id=d.empresa_id
        LEFT JOIN ${tCli} c ON c.id=v.cliente_id AND c.empresa_id=v.empresa_id
        LEFT JOIN ${tEnt} eb ON eb.id=d.entidad_bancaria_id AND eb.empresa_id=d.empresa_id
       -- ventas_pagos_detalle no lleva sucursal_id: se filtra por la venta padre (v).
       WHERE d.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
         AND d.metodo_pago IS NOT NULL AND d.metodo_pago <> 'efectivo'
      UNION ALL
      SELECT cc.id::text AS id, 'cobro'::text AS tipo, cc.fecha_pago AS fecha,
             COALESCE(vc.numero_control, cta.numero_venta) AS numero, c.nombre AS cliente, cc.metodo_pago AS metodo,
             COALESCE(NULLIF(cc.entidad_nombre_snapshot,''),'(sin entidad)') AS entidad,
             eb.codigo AS entidad_codigo,
             cc.referencia AS referencia, cc.titular AS titular, cc.monto::float8 AS monto,
             cc.conciliacion_estado AS estado
        FROM ${tCob} cc
        LEFT JOIN ${tV} vc ON vc.id=cc.venta_id AND vc.empresa_id=cc.empresa_id
        LEFT JOIN ${tCxc} cta ON cta.id=cc.cuenta_por_cobrar_id AND cta.empresa_id=cc.empresa_id
        LEFT JOIN ${tCli} c ON c.id=cc.cliente_id AND c.empresa_id=cc.empresa_id
        LEFT JOIN ${tEnt} eb ON eb.id=cc.entidad_bancaria_id AND eb.empresa_id=cc.empresa_id
       WHERE cc.empresa_id=$1::uuid AND cc.fecha_pago>=$2::timestamptz AND cc.fecha_pago<=$3::timestamptz
         AND cc.metodo_pago IS NOT NULL AND cc.metodo_pago <> 'efectivo'
    )`;

  const movsQ = p.query<ConciliacionMovRow>(
    `${movsCTE} SELECT id, tipo, fecha, numero, cliente, metodo AS metodo_pago, entidad, entidad_codigo, referencia, titular, monto, estado FROM movs ORDER BY (estado='pendiente') DESC, fecha DESC`, args);
  const totQ = p.query<{ cantidad: number; total: number }>(
    `${movsCTE} SELECT count(*)::int AS cantidad, COALESCE(SUM(monto),0)::float8 AS total FROM movs`, args);
  const porMetodoQ = p.query<ConciliacionAgrupado>(
    `${movsCTE} SELECT metodo AS clave, count(*)::int AS cantidad, COALESCE(SUM(monto),0)::float8 AS total
       FROM movs GROUP BY metodo ORDER BY total DESC`, args);
  const porEntidadQ = p.query<ConciliacionAgrupado>(
    `${movsCTE} SELECT entidad AS clave, count(*)::int AS cantidad, COALESCE(SUM(monto),0)::float8 AS total
       FROM movs GROUP BY entidad ORDER BY total DESC`, args);

  const [movs, tot, porMetodo, porEntidad] = await Promise.all([movsQ, totQ, porMetodoQ, porEntidadQ]);

  const estadoVal = (e: unknown): "pendiente" | "aprobado" | "rechazado" =>
    e === "aprobado" || e === "rechazado" ? e : "pendiente";
  const movimientos: ConciliacionMovRow[] = movs.rows.map((r) => ({
    id: r.id,
    tipo: r.tipo === "cobro" ? "cobro" : "venta",
    fecha: r.fecha,
    numero: r.numero || null,
    cliente: r.cliente || null,
    metodo_pago: r.metodo_pago || null,
    entidad: r.entidad || null,
    entidad_codigo: r.entidad_codigo || null,
    referencia: r.referencia || null,
    titular: r.titular || null,
    monto: num(r.monto),
    estado: estadoVal(r.estado),
  }));

  return {
    mes: b.mes,
    totalCobrado: num(tot.rows[0]?.total),
    cantidadOperaciones: num(tot.rows[0]?.cantidad),
    porMetodo: porMetodo.rows.map((r) => ({ clave: r.clave, cantidad: num(r.cantidad), total: num(r.total) })),
    porEntidad: porEntidad.rows.map((r) => ({ clave: r.clave, cantidad: num(r.cantidad), total: num(r.total) })),
    movimientos,
  };
}

// ── Ganancias (P&L simplificado, un período arbitrario) ───────────────────────

/** Rango de un período: timestamptz para ventas/movimientos, fecha DATE para gastos. */
export interface GananciasBounds {
  start: string; // ISO UTC (ventas.fecha, movimientos.fecha — timestamptz)
  end: string; // ISO UTC (inclusive)
  desde: string; // YYYY-MM-DD (gastos.fecha — DATE)
  hasta: string; // YYYY-MM-DD (inclusive)
}

/**
 * Métricas de rentabilidad de UN período. Se llama dos veces (actual + anterior)
 * para armar la comparación.
 *
 * - Ventas netas = SUM(v.subtotal) — sin IVA (base del margen).
 * - Ventas totales = SUM(v.total) — con IVA (informativo).
 * - CMV = SUM(m.cantidad · m.costo_unitario) de movimientos SALIDA origen='venta',
 *   unidos a la venta por venta_id y filtrando ventas NO anuladas — así el costo
 *   corresponde exactamente a lo vendido (no a todas las compras) y no arrastra
 *   ventas anuladas (cuya reversa entra como movimiento 'anulacion_venta').
 * - Gastos = SUM(gastos.monto) del período.
 */
export async function getGananciasPeriodo(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: GananciasBounds
): Promise<GananciasPeriodo> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tG = quoteSchemaTable(schema, "gastos");
  const p = pool();

  const tP = quoteSchemaTable(schema, "productos");
  // NUTRICIÓN: excluye ventas de consignación (origen='consignacion'), que tienen
  // su propio P&L basado en comisión (ver getGananciasConsignataria).
  const perV = `v.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz`
    + ` AND COALESCE(v.estado,'completada') <> 'anulada'`
    + ` AND COALESCE(v.origen,'') <> 'consignacion'`;
  const argsV = [empresaId, b.start, b.end];

  const ventasQ = p.query<{ netas: number; totales: number; cant: number }>(
    `SELECT COALESCE(SUM(v.subtotal),0)::float8 AS netas,
            COALESCE(SUM(v.total),0)::float8 AS totales,
            count(*)::int AS cant
       FROM ${tV} v WHERE ${perV}`, argsV);

  // CMV SIN IVA: el costo guardado (costo_promedio → movimiento) INCLUYE IVA
  // (se hereda del costo_unitario de compras, que es con IVA). Para que el margen
  // sea correcto contra las ventas netas (sin IVA), se le quita el IVA usando la
  // tasa real de cada producto (productos.tipo_iva: '10%' | '5%' | 'EXENTA').
  const cmvQ = p.query<{ cmv: number }>(
    `SELECT COALESCE(SUM(
              (m.cantidad * m.costo_unitario) /
              CASE COALESCE(pr.tipo_iva,'10%')
                WHEN '10%'   THEN 1.10
                WHEN '5%'    THEN 1.05
                WHEN 'EXENTA' THEN 1.0
                ELSE 1.10
              END
            ),0)::float8 AS cmv
       FROM ${tM} m
       JOIN ${tV} v ON v.id = m.venta_id AND v.empresa_id = m.empresa_id
       LEFT JOIN ${tP} pr ON pr.id = m.producto_id AND pr.empresa_id = m.empresa_id
      WHERE m.empresa_id=$1::uuid AND m.tipo='SALIDA' AND m.origen='venta'
        AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
        AND COALESCE(v.estado,'completada') <> 'anulada'
        AND COALESCE(v.origen,'') <> 'consignacion'${SUC_V}`, argsV);

  // Gastos operativos de NUTRICIÓN (excluye los marcados como consignataria).
  const gastosQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(monto),0)::float8 AS total FROM ${tG}
      WHERE empresa_id=$1::uuid${SUC} AND fecha>=$2::date AND fecha<=$3::date
        AND COALESCE(unidad_negocio,'nutricion') <> 'consignataria'`,
    [empresaId, b.desde, b.hasta]);

  const [ventas, cmv, gastos] = await Promise.all([ventasQ, cmvQ, gastosQ]);

  const netas = num(ventas.rows[0]?.netas);
  const totales = num(ventas.rows[0]?.totales);
  const costo = num(cmv.rows[0]?.cmv);
  const gastosTot = num(gastos.rows[0]?.total);
  const gananciaBruta = netas - costo;
  const gananciaNeta = gananciaBruta - gastosTot;

  return {
    ventasNetas: netas,
    ventasTotales: totales,
    cmv: costo,
    gananciaBruta,
    margenBruto: netas > 0 ? (gananciaBruta / netas) * 100 : 0,
    gastos: gastosTot,
    gananciaNeta,
    margenNeto: netas > 0 ? (gananciaNeta / netas) * 100 : 0,
    cantidadVentas: num(ventas.rows[0]?.cant),
  };
}

/**
 * P&L de la operación CONSIGNATARIA. Estructura distinta a nutrición:
 *  - "Ventas" = comisión facturada (ventas.total con origen='consignacion').
 *  - "CMV" = compras de consignataria (consignacion_compras.monto_total).
 *  - Gastos = consignacion_gastos + gastos marcados unidad_negocio='consignataria'.
 * No hay CMV de mercadería propia (los bienes no son de la empresa). Se devuelve
 * en el mismo shape que nutrición para poder consolidar y mostrar en la misma UI.
 * Igual que el estado de cuenta de consignataria, NO se filtra por sucursal.
 */
export async function getGananciasConsignataria(
  schemaRaw: string,
  empresaId: string,
  b: GananciasBounds
): Promise<GananciasPeriodo> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tCC = quoteSchemaTable(schema, "consignacion_compras");
  const tCG = quoteSchemaTable(schema, "consignacion_gastos");
  const tG = quoteSchemaTable(schema, "gastos");
  const p = pool();

  const comisionQ = p.query<{ total: number; cant: number }>(
    `SELECT COALESCE(SUM(total),0)::float8 AS total, count(*)::int AS cant
       FROM ${tV}
      WHERE empresa_id=$1::uuid AND origen='consignacion'
        AND COALESCE(estado,'completada') <> 'anulada'
        AND fecha>=$2::timestamptz AND fecha<=$3::timestamptz`,
    [empresaId, b.start, b.end]);
  const comprasQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(monto_total),0)::float8 AS total FROM ${tCC}
      WHERE empresa_id=$1::uuid AND COALESCE(estado,'registrada') <> 'anulada'
        AND fecha>=$2::date AND fecha<=$3::date`,
    [empresaId, b.desde, b.hasta]);
  const gastosCgQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(monto),0)::float8 AS total FROM ${tCG}
      WHERE empresa_id=$1::uuid AND fecha>=$2::date AND fecha<=$3::date`,
    [empresaId, b.desde, b.hasta]);
  const gastosGenQ = p.query<{ total: number }>(
    `SELECT COALESCE(SUM(monto),0)::float8 AS total FROM ${tG}
      WHERE empresa_id=$1::uuid AND unidad_negocio='consignataria'
        AND fecha>=$2::date AND fecha<=$3::date`,
    [empresaId, b.desde, b.hasta]);

  const [com, comp, gcg, ggen] = await Promise.all([comisionQ, comprasQ, gastosCgQ, gastosGenQ]);

  const comision = num(com.rows[0]?.total);
  const costo = num(comp.rows[0]?.total);
  const gastosTot = num(gcg.rows[0]?.total) + num(ggen.rows[0]?.total);
  const gananciaBruta = comision - costo;
  const gananciaNeta = gananciaBruta - gastosTot;

  return {
    ventasNetas: comision,
    ventasTotales: comision,
    cmv: costo,
    gananciaBruta,
    margenBruto: comision > 0 ? (gananciaBruta / comision) * 100 : 0,
    gastos: gastosTot,
    gananciaNeta,
    margenNeto: comision > 0 ? (gananciaNeta / comision) * 100 : 0,
    cantidadVentas: num(com.rows[0]?.cant),
  };
}

// ── Rentabilidad por producto / rubro ────────────────────────────────────

export interface RentabilidadResultado {
  filas: RentabilidadRow[];
  totalFacturacion: number;
  totalCosto: number;
  totalGanancia: number;
}

/**
 * Rentabilidad de ventas propias (Nutrición; excluye consignación) agrupada por
 * producto o por rubro. Facturación = subtotal (sin IVA) de las líneas;
 * costo = CMV sin IVA (movimientos SALIDA origen='venta', quitando IVA por la
 * tasa de cada producto). Margen y participación se calculan sobre esos totales.
 */
export async function getRentabilidad(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: GananciasBounds,
  agrupar: AgruparRentabilidad
): Promise<RentabilidadResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tCat = quoteSchemaTable(schema, "categorias_productos");
  const p = pool();
  const args = [empresaId, b.start, b.end];

  // CTEs comunes: ventas del período (nutrición), facturación y costo por producto.
  const ctes = `
    WITH vp AS (
      SELECT v.id FROM ${tV} v
       WHERE v.empresa_id=$1::uuid${SUC_V}
         AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
         AND COALESCE(v.estado,'completada') <> 'anulada'
         AND COALESCE(v.origen,'') <> 'consignacion'
    ),
    fact AS (
      SELECT vi.producto_id,
             SUM(vi.cantidad)::float8 AS unidades,
             SUM(vi.subtotal)::float8 AS facturacion
        FROM ${tVI} vi JOIN vp ON vp.id = vi.venta_id
       WHERE vi.empresa_id=$1::uuid
       GROUP BY vi.producto_id
    ),
    costo AS (
      SELECT m.producto_id,
             SUM((m.cantidad * m.costo_unitario) /
                 CASE COALESCE(pr.tipo_iva,'10%')
                   WHEN '10%' THEN 1.10 WHEN '5%' THEN 1.05 WHEN 'EXENTA' THEN 1.0 ELSE 1.10 END
             )::float8 AS costo
        FROM ${tM} m JOIN vp ON vp.id = m.venta_id
        LEFT JOIN ${tP} pr ON pr.id = m.producto_id AND pr.empresa_id=$1::uuid
       WHERE m.empresa_id=$1::uuid AND m.tipo='SALIDA' AND m.origen='venta'
       GROUP BY m.producto_id
    )`;

  let rows: Array<{ id: string; nombre: string; sku?: string | null; categoria?: string | null; unidades: number; facturacion: number; costo: number }>;

  if (agrupar === "categoria") {
    const q = await p.query(
      `${ctes}
       SELECT COALESCE(cat.id::text,'sin-categoria') AS id,
              COALESCE(cat.nombre,'Sin rubro') AS nombre,
              SUM(f.unidades)::float8 AS unidades,
              SUM(f.facturacion)::float8 AS facturacion,
              SUM(COALESCE(c.costo,0))::float8 AS costo
         FROM fact f
         JOIN ${tP} p2 ON p2.id = f.producto_id AND p2.empresa_id=$1::uuid
         LEFT JOIN ${tCat} cat ON cat.id = p2.categoria_principal_id
         LEFT JOIN costo c ON c.producto_id = f.producto_id
        GROUP BY cat.id, cat.nombre
        ORDER BY (SUM(f.facturacion) - SUM(COALESCE(c.costo,0))) DESC`,
      args
    );
    rows = q.rows as typeof rows;
  } else {
    const q = await p.query(
      `${ctes}
       SELECT p2.id::text AS id, p2.nombre AS nombre, p2.sku AS sku,
              cat.nombre AS categoria,
              f.unidades AS unidades, f.facturacion AS facturacion,
              COALESCE(c.costo,0)::float8 AS costo
         FROM fact f
         JOIN ${tP} p2 ON p2.id = f.producto_id AND p2.empresa_id=$1::uuid
         LEFT JOIN ${tCat} cat ON cat.id = p2.categoria_principal_id
         LEFT JOIN costo c ON c.producto_id = f.producto_id
        ORDER BY (f.facturacion - COALESCE(c.costo,0)) DESC`,
      args
    );
    rows = q.rows as typeof rows;
  }

  const totalFacturacion = rows.reduce((s, r) => s + num(r.facturacion), 0);
  const totalCosto = rows.reduce((s, r) => s + num(r.costo), 0);
  const totalGanancia = totalFacturacion - totalCosto;

  const filas: RentabilidadRow[] = rows.map((r) => {
    const facturacion = num(r.facturacion);
    const costo = num(r.costo);
    const ganancia = facturacion - costo;
    return {
      id: r.id,
      nombre: r.nombre,
      sku: r.sku ?? null,
      categoria: r.categoria ?? null,
      unidades: num(r.unidades),
      facturacion,
      costo,
      ganancia,
      margen: facturacion > 0 ? (ganancia / facturacion) * 100 : 0,
      participacion: totalGanancia !== 0 ? (ganancia / totalGanancia) * 100 : 0,
    };
  });

  return { filas, totalFacturacion, totalCosto, totalGanancia };
}

// ── Flujo de caja real (cobrado − pagado) ────────────────────────────────────

export interface FlujoCajaResultado {
  saldoInicial: number;
  entradaContado: number;
  entradaCobros: number;
  salidaCompras: number;
  salidaGastos: number;
  totalEntradas: number;
  totalSalidas: number;
  saldoFinal: number;
  movimientos: MovimientoCaja[];
}

/**
 * Flujo de caja REAL de un período: dinero efectivamente cobrado − pagado.
 *  - Entradas = ventas al contado (día de la venta) + cobros de crédito (día del cobro).
 *  - Salidas = compras marcadas pagadas (día del pago) + gastos (su fecha).
 *  - Saldo inicial = acumulado del sistema (entradas − salidas) ANTES del período.
 * Excluye ventas anuladas. Los cobros reversados se borran, así que no suman.
 * `cobros_clientes` no tiene sucursal (se filtra solo por empresa, igual que Conciliación).
 */
export async function getFlujoCaja(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: GananciasBounds
): Promise<FlujoCajaResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC = andSucursal(sucursalId);
  const SUC_C = andSucursal(sucursalId, "c.");
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tCob = quoteSchemaTable(schema, "cobros_clientes");
  const tC = quoteSchemaTable(schema, "compras");
  const tG = quoteSchemaTable(schema, "gastos");
  const p = pool();
  const args = [empresaId, b.start, b.end, b.desde, b.hasta];

  // Cada query devuelve el total del período y el acumulado "antes" (para el saldo inicial).
  const ventasQ = p.query<{ periodo: number; antes: number }>(
    `SELECT COALESCE(SUM(v.total) FILTER (WHERE v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz),0)::float8 AS periodo,
            COALESCE(SUM(v.total) FILTER (WHERE v.fecha<$2::timestamptz),0)::float8 AS antes
       FROM ${tV} v
      WHERE v.empresa_id=$1::uuid${SUC_V}
        AND COALESCE(v.tipo_venta,'') <> 'CREDITO'
        AND COALESCE(v.estado,'completada') <> 'anulada'`, args);
  const cobrosQ = p.query<{ periodo: number; antes: number }>(
    `SELECT COALESCE(SUM(monto) FILTER (WHERE fecha_pago>=$2::timestamptz AND fecha_pago<=$3::timestamptz),0)::float8 AS periodo,
            COALESCE(SUM(monto) FILTER (WHERE fecha_pago<$2::timestamptz),0)::float8 AS antes
       FROM ${tCob} WHERE empresa_id=$1::uuid`, args);
  const gastosQ = p.query<{ periodo: number; antes: number }>(
    `SELECT COALESCE(SUM(monto) FILTER (WHERE fecha>=$4::date AND fecha<=$5::date),0)::float8 AS periodo,
            COALESCE(SUM(monto) FILTER (WHERE fecha<$4::date),0)::float8 AS antes
       FROM ${tG} WHERE empresa_id=$1::uuid${SUC}`, args);

  // Entradas + gastos (siempre disponibles).
  const movsMainQ = p.query<MovimientoCaja>(
    `SELECT fecha, tipo, referencia, descripcion, metodo, entrada::float8 AS entrada, salida::float8 AS salida FROM (
        SELECT v.fecha AS fecha, 'Venta contado'::text AS tipo, v.numero_control AS referencia,
               NULL::text AS descripcion, v.metodo_pago AS metodo, v.total AS entrada, 0 AS salida
          FROM ${tV} v
         WHERE v.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
           AND COALESCE(v.tipo_venta,'') <> 'CREDITO' AND COALESCE(v.estado,'completada') <> 'anulada'
        UNION ALL
        SELECT cc.fecha_pago, 'Cobro'::text, NULL::text, 'Cobro de cliente'::text, cc.metodo_pago, cc.monto, 0
          FROM ${tCob} cc
         WHERE cc.empresa_id=$1::uuid AND cc.fecha_pago>=$2::timestamptz AND cc.fecha_pago<=$3::timestamptz
        UNION ALL
        SELECT g.fecha::timestamptz, 'Gasto'::text, NULLIF(g.categoria,''), COALESCE(g.descripcion,''), g.metodo_pago, 0, g.monto
          FROM ${tG} g
         WHERE g.empresa_id=$1::uuid${SUC} AND g.fecha>=$4::date AND g.fecha<=$5::date
      ) m ORDER BY fecha DESC LIMIT 500`, args);

  // Compras pagadas: dependen de compras.fecha_pago, que puede no existir en la
  // base (si nunca se marcó una compra como pagada). Se aíslan con .catch para
  // que su ausencia NO rompa todo el flujo de caja (en ese caso, salidas de
  // compras = 0, que es lo correcto: no hay pagos de compra registrados).
  const ZERO = { rows: [{ periodo: 0, antes: 0 }] };
  const comprasQ = p
    .query<{ periodo: number; antes: number }>(
      `SELECT COALESCE(SUM(c.total) FILTER (WHERE c.fecha_pago::date>=$4::date AND c.fecha_pago::date<=$5::date),0)::float8 AS periodo,
              COALESCE(SUM(c.total) FILTER (WHERE c.fecha_pago::date<$4::date),0)::float8 AS antes
         FROM ${tC} c
        WHERE c.empresa_id=$1::uuid${SUC_C} AND COALESCE(c.estado,'registrada')='pagada' AND c.fecha_pago IS NOT NULL`, args)
    .catch(() => ZERO);
  const movsComprasQ = p
    .query<MovimientoCaja>(
      `SELECT cp.fp::timestamptz AS fecha, 'Pago compra'::text AS tipo, cp.numero_control AS referencia,
              cp.prov AS descripcion, cp.met AS metodo, 0::float8 AS entrada, cp.total::float8 AS salida
         FROM (SELECT numero_control, MIN(fecha_pago) AS fp, MIN(proveedor_nombre) AS prov,
                      MIN(metodo_pago) AS met, SUM(total)::float8 AS total
                 FROM ${tC} c
                WHERE c.empresa_id=$1::uuid${SUC_C} AND COALESCE(c.estado,'registrada')='pagada'
                  AND c.fecha_pago::date>=$4::date AND c.fecha_pago::date<=$5::date
                GROUP BY numero_control) cp`, args)
    .catch(() => ({ rows: [] as MovimientoCaja[] }));

  const [ventas, cobros, gastos, movsMain, compras, movsCompras] = await Promise.all([
    ventasQ, cobrosQ, gastosQ, movsMainQ, comprasQ, movsComprasQ,
  ]);

  const entradaContado = num(ventas.rows[0]?.periodo);
  const entradaCobros = num(cobros.rows[0]?.periodo);
  const salidaCompras = num(compras.rows[0]?.periodo);
  const salidaGastos = num(gastos.rows[0]?.periodo);
  const saldoInicial =
    (num(ventas.rows[0]?.antes) + num(cobros.rows[0]?.antes)) -
    (num(compras.rows[0]?.antes) + num(gastos.rows[0]?.antes));
  const totalEntradas = entradaContado + entradaCobros;
  const totalSalidas = salidaCompras + salidaGastos;

  const movimientos: MovimientoCaja[] = [...movsMain.rows, ...movsCompras.rows]
    .map((m) => ({
      fecha: m.fecha,
      tipo: m.tipo,
      referencia: m.referencia ?? null,
      descripcion: m.descripcion ?? null,
      metodo: m.metodo ?? null,
      entrada: num(m.entrada),
      salida: num(m.salida),
    }))
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .slice(0, 500);

  return {
    saldoInicial,
    entradaContado,
    entradaCobros,
    salidaCompras,
    salidaGastos,
    totalEntradas,
    totalSalidas,
    saldoFinal: saldoInicial + totalEntradas - totalSalidas,
    movimientos,
  };
}

// ── Tesorería por banco / cuenta / POS ───────────────────────────────────────

export interface TesoreriaResultado {
  filas: TesoreriaRow[];
  totalEntradas: number;
  totalPendienteConciliar: number;
}

/**
 * Movimientos de dinero agrupados por entidad (banco/cuenta/POS/efectivo).
 * Entradas = cobros de ventas contado (ventas_pagos_detalle) + cobros de crédito
 * (cobros_clientes), agrupados por la entidad snapshot. El efectivo va como
 * "Efectivo (caja)". Las SALIDAS todavía no guardan entidad (compras/gastos), por
 * eso salen en 0 hasta que se agregue ese campo. `pendienteConciliar` = entradas
 * bancarias con conciliacion_estado='pendiente' (el efectivo no se concilia).
 */
export async function getTesoreria(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: GananciasBounds
): Promise<TesoreriaResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tD = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tCob = quoteSchemaTable(schema, "cobros_clientes");
  const p = pool();
  const args = [empresaId, b.start, b.end];

  const entidadExpr = (alias: string) =>
    `COALESCE(NULLIF(${alias}.entidad_nombre_snapshot,''), CASE WHEN ${alias}.metodo_pago='efectivo' THEN 'Efectivo (caja)' ELSE '(sin entidad)' END)`;

  const q = await p.query<{ entidad: string; entradas: number; pendiente: number; cantidad: number }>(
    `WITH movs AS (
        SELECT ${entidadExpr("d")} AS entidad, d.metodo_pago AS metodo, d.monto::float8 AS monto, d.conciliacion_estado AS estado
          FROM ${tD} d
          JOIN ${tV} v ON v.id=d.venta_id AND v.empresa_id=d.empresa_id
         WHERE d.empresa_id=$1::uuid${SUC_V} AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
           AND d.metodo_pago IS NOT NULL AND COALESCE(v.estado,'completada') <> 'anulada'
        UNION ALL
        SELECT ${entidadExpr("cc")}, cc.metodo_pago, cc.monto::float8, cc.conciliacion_estado
          FROM ${tCob} cc
         WHERE cc.empresa_id=$1::uuid AND cc.fecha_pago>=$2::timestamptz AND cc.fecha_pago<=$3::timestamptz
           AND cc.metodo_pago IS NOT NULL
      )
      SELECT entidad,
             COALESCE(SUM(monto),0)::float8 AS entradas,
             COALESCE(SUM(monto) FILTER (WHERE estado='pendiente' AND metodo <> 'efectivo'),0)::float8 AS pendiente,
             count(*)::int AS cantidad
        FROM movs GROUP BY entidad ORDER BY entradas DESC`, args);

  const filas: TesoreriaRow[] = q.rows.map((r) => ({
    entidad: r.entidad,
    entradas: num(r.entradas),
    salidas: 0,
    saldoSistema: num(r.entradas),
    pendienteConciliar: num(r.pendiente),
    cantidad: num(r.cantidad),
  }));

  return {
    filas,
    totalEntradas: filas.reduce((s, r) => s + r.entradas, 0),
    totalPendienteConciliar: filas.reduce((s, r) => s + r.pendienteConciliar, 0),
  };
}

/** Suma dos períodos (para el consolidado Nutrición + Consignataria). */
export function sumarGananciasPeriodo(a: GananciasPeriodo, b: GananciasPeriodo): GananciasPeriodo {
  const ventasNetas = a.ventasNetas + b.ventasNetas;
  const gananciaBruta = a.gananciaBruta + b.gananciaBruta;
  const gananciaNeta = a.gananciaNeta + b.gananciaNeta;
  return {
    ventasNetas,
    ventasTotales: a.ventasTotales + b.ventasTotales,
    cmv: a.cmv + b.cmv,
    gananciaBruta,
    margenBruto: ventasNetas > 0 ? (gananciaBruta / ventasNetas) * 100 : 0,
    gastos: a.gastos + b.gastos,
    gananciaNeta,
    margenNeto: ventasNetas > 0 ? (gananciaNeta / ventasNetas) * 100 : 0,
    cantidadVentas: a.cantidadVentas + b.cantidadVentas,
  };
}
