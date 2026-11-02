/**
 * Qué vende cada vendedor: agregados SQL del reporte por vendedor.
 *
 * ── DE DÓNDE SALE EL VENDEDOR DE UNA VENTA ────────────────────────────────
 *   `ventas.vendedor_usuario_id` es quien la vendió; `ventas.usuario_id` es
 *   quien la cargó en caja. En el mostrador muchas veces son la misma
 *   persona, y en las ventas viejas el vendedor venía vacío. Si no se cayera
 *   al usuario, esas ventas desaparecerían del reporte sin avisar: el total
 *   por vendedor no cerraría contra la facturación del mes y nadie sabría por
 *   qué. Por eso: vendedor → usuario → "Sin vendedor", en ese orden, y el
 *   agrupado es por id (el nombre puede estar escrito distinto en dos ventas).
 *
 * ── LOS NÚMEROS SON LOS DE RENTABILIDAD ───────────────────────────────────
 *   Facturación = suma de `ventas_items.subtotal` (sin IVA). Costo = CMV sin
 *   IVA desde `movimientos_inventario` al momento de la venta. Se excluyen
 *   anuladas y consignación. Es a propósito idéntico a `getRentabilidad`:
 *   dos reportes del mismo mes que dan números distintos no se usan, se
 *   discuten.
 */
import { andSucursal } from "@/lib/sucursales/sql";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { GananciasBounds } from "./reportes-pg";
import type {
  AgruparVendedor,
  VendedorItemRow,
  VendedorRow,
} from "@/lib/reportes/vendedores-types";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/** Cuántos productos se muestran en la tarjeta de cada vendedor. */
const TOP_POR_VENDEDOR = 5;

type FilaCruda = {
  vend_id: string;
  vend_nombre: string;
  id: string;
  nombre: string;
  sku: string | null;
  categoria: string | null;
  unidades: number;
  facturacion: number;
  costo: number;
};

type TotalCrudo = {
  vend_id: string;
  vend_nombre: string;
  ventas: number;
  facturacion: number;
  costo: number;
  unidades: number;
};

export interface VendedoresResultado {
  totalFacturacion: number;
  totalCosto: number;
  totalUtilidad: number;
  totalVentas: number;
  vendedores: VendedorRow[];
  detalle: { vendedorId: string; nombre: string; filas: VendedorItemRow[] } | null;
}

function utilidadDe(facturacion: number, costo: number) {
  const utilidad = facturacion - costo;
  return {
    utilidad,
    margen: facturacion > 0 ? (utilidad / facturacion) * 100 : 0,
  };
}

function aItemRow(f: FilaCruda, facturacionDelVendedor: number): VendedorItemRow {
  const facturacion = Number(f.facturacion) || 0;
  const costo = Number(f.costo) || 0;
  const { utilidad, margen } = utilidadDe(facturacion, costo);
  return {
    id: f.id,
    nombre: f.nombre,
    sku: f.sku ?? null,
    categoria: f.categoria ?? null,
    unidades: Number(f.unidades) || 0,
    facturacion,
    costo,
    utilidad,
    margen,
    participacion: facturacionDelVendedor > 0 ? (facturacion / facturacionDelVendedor) * 100 : 0,
  };
}

export async function getVentasPorVendedor(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string,
  b: GananciasBounds,
  agrupar: AgruparVendedor,
  vendedorPedido: string | null
): Promise<VendedoresResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const SUC_V = andSucursal(sucursalId, "v.");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tCat = quoteSchemaTable(schema, "categorias_productos");
  const p = pool();
  const args = [empresaId, b.start, b.end];

  /**
   * `vp` resuelve el vendedor de cada venta una sola vez, y de ahí cuelgan
   * todas las demás sumas. El `::text` del id es para poder usar el mismo
   * campo cuando no hay vendedor ni usuario ("sin-vendedor" no es un uuid).
   */
  const ctes = `
    WITH vp AS (
      SELECT v.id,
             COALESCE(v.vendedor_usuario_id::text, v.usuario_id::text, 'sin-vendedor') AS vend_id,
             COALESCE(
               NULLIF(btrim(v.vendedor_nombre), ''),
               NULLIF(btrim(v.usuario_nombre), ''),
               'Sin vendedor'
             ) AS vend_nombre
        FROM ${tV} v
       WHERE v.empresa_id=$1::uuid${SUC_V}
         AND v.fecha>=$2::timestamptz AND v.fecha<=$3::timestamptz
         AND COALESCE(v.estado,'completada') <> 'anulada'
         AND COALESCE(v.origen,'') <> 'consignacion'
    ),
    fact AS (
      SELECT vp.vend_id, vi.producto_id,
             SUM(vi.cantidad)::float8 AS unidades,
             SUM(vi.subtotal)::float8 AS facturacion
        FROM ${tVI} vi JOIN vp ON vp.id = vi.venta_id
       WHERE vi.empresa_id=$1::uuid
       GROUP BY vp.vend_id, vi.producto_id
    ),
    costo AS (
      SELECT vp.vend_id, m.producto_id,
             SUM((m.cantidad * m.costo_unitario) /
                 CASE COALESCE(pr.tipo_iva,'10%')
                   WHEN '10%' THEN 1.10 WHEN '5%' THEN 1.05 WHEN 'EXENTA' THEN 1.0 ELSE 1.10 END
             )::float8 AS costo
        FROM ${tM} m JOIN vp ON vp.id = m.venta_id
        LEFT JOIN ${tP} pr ON pr.id = m.producto_id AND pr.empresa_id=$1::uuid
       WHERE m.empresa_id=$1::uuid AND m.tipo='SALIDA' AND m.origen='venta'
       GROUP BY vp.vend_id, m.producto_id
    ),
    nombres AS (
      SELECT vend_id, MIN(vend_nombre) AS vend_nombre, COUNT(*)::int AS ventas
        FROM vp GROUP BY vend_id
    )`;

  // ── Totales por vendedor ────────────────────────────────────────────────
  //   La cantidad de VENTAS sale de `vp` (comprobantes), no de las líneas:
  //   contar líneas daría "12 ventas" para una venta de 12 productos.
  const totQ = await p.query<TotalCrudo>(
    `${ctes}
     SELECT n.vend_id, n.vend_nombre, n.ventas,
            COALESCE(SUM(f.facturacion), 0)::float8 AS facturacion,
            COALESCE(SUM(c.costo), 0)::float8 AS costo,
            COALESCE(SUM(f.unidades), 0)::float8 AS unidades
       FROM nombres n
       LEFT JOIN fact f ON f.vend_id = n.vend_id
       LEFT JOIN costo c ON c.vend_id = n.vend_id AND c.producto_id = f.producto_id
      GROUP BY n.vend_id, n.vend_nombre, n.ventas
      ORDER BY 4 DESC`,
    args
  );

  const selectFilas = () =>
    agrupar === "categoria"
      ? p.query<FilaCruda>(
          `${ctes}
           SELECT f.vend_id,
                  n.vend_nombre,
                  COALESCE(cat.id::text,'sin-categoria') AS id,
                  COALESCE(cat.nombre,'Sin rubro') AS nombre,
                  NULL::text AS sku,
                  NULL::text AS categoria,
                  SUM(f.unidades)::float8 AS unidades,
                  SUM(f.facturacion)::float8 AS facturacion,
                  SUM(COALESCE(c.costo,0))::float8 AS costo
             FROM fact f
             JOIN nombres n ON n.vend_id = f.vend_id
             JOIN ${tP} p2 ON p2.id = f.producto_id AND p2.empresa_id=$1::uuid
             LEFT JOIN ${tCat} cat ON cat.id = p2.categoria_principal_id
             LEFT JOIN costo c ON c.vend_id = f.vend_id AND c.producto_id = f.producto_id
            GROUP BY f.vend_id, n.vend_nombre, cat.id, cat.nombre
            ORDER BY f.vend_id, SUM(f.facturacion) DESC`,
          args
        )
      : p.query<FilaCruda>(
          `${ctes}
           SELECT f.vend_id,
                  n.vend_nombre,
                  p2.id::text AS id,
                  p2.nombre AS nombre,
                  p2.sku AS sku,
                  cat.nombre AS categoria,
                  f.unidades AS unidades,
                  f.facturacion AS facturacion,
                  COALESCE(c.costo,0)::float8 AS costo
             FROM fact f
             JOIN nombres n ON n.vend_id = f.vend_id
             JOIN ${tP} p2 ON p2.id = f.producto_id AND p2.empresa_id=$1::uuid
             LEFT JOIN ${tCat} cat ON cat.id = p2.categoria_principal_id
             LEFT JOIN costo c ON c.vend_id = f.vend_id AND c.producto_id = f.producto_id
            ORDER BY f.vend_id, f.facturacion DESC`,
          args
        );

  // Las filas para las tarjetas: todas, y se recortan al top en memoria. Es
  // una fila por vendedor y producto del período — para una ferretería es del
  // orden de cientos, no de millones.
  const filasQ = await selectFilas();

  const totalesPorVend = new Map<string, TotalCrudo>();
  for (const t of totQ.rows) totalesPorVend.set(t.vend_id, t);

  const totalFacturacion = totQ.rows.reduce((s, t) => s + (Number(t.facturacion) || 0), 0);
  const totalCosto = totQ.rows.reduce((s, t) => s + (Number(t.costo) || 0), 0);
  const totalVentas = totQ.rows.reduce((s, t) => s + (Number(t.ventas) || 0), 0);

  const porVendedor = new Map<string, FilaCruda[]>();
  for (const f of filasQ.rows) {
    const lista = porVendedor.get(f.vend_id);
    if (lista) lista.push(f);
    else porVendedor.set(f.vend_id, [f]);
  }

  const vendedores: VendedorRow[] = totQ.rows.map((t) => {
    const facturacion = Number(t.facturacion) || 0;
    const costo = Number(t.costo) || 0;
    const { utilidad, margen } = utilidadDe(facturacion, costo);
    const ventas = Number(t.ventas) || 0;
    const filas = porVendedor.get(t.vend_id) ?? [];
    return {
      id: t.vend_id,
      nombre: t.vend_nombre,
      ventas,
      unidades: Number(t.unidades) || 0,
      facturacion,
      costo,
      utilidad,
      margen,
      participacion: totalFacturacion > 0 ? (facturacion / totalFacturacion) * 100 : 0,
      ticketPromedio: ventas > 0 ? facturacion / ventas : 0,
      top: filas.slice(0, TOP_POR_VENDEDOR).map((f) => aItemRow(f, facturacion)),
    };
  });

  let detalle: VendedoresResultado["detalle"] = null;
  if (vendedorPedido) {
    const facturacionVend = Number(totalesPorVend.get(vendedorPedido)?.facturacion) || 0;
    const filas = (porVendedor.get(vendedorPedido) ?? []).map((f) => aItemRow(f, facturacionVend));
    detalle = {
      vendedorId: vendedorPedido,
      nombre: totalesPorVend.get(vendedorPedido)?.vend_nombre ?? "Sin vendedor",
      filas,
    };
  }

  return {
    totalFacturacion,
    totalCosto,
    totalUtilidad: totalFacturacion - totalCosto,
    totalVentas,
    vendedores,
    detalle,
  };
}
