/**
 * Planilla "Stock con precios".
 *
 * ── DE DÓNDE SALE ─────────────────────────────────────────────────────────
 *   Es el informe que el cliente venía armando a mano con el sistema viejo:
 *   un archivo por sucursal y por mes, con nombre `stockconprecio-9-2025_
 *   CENTRAL.xls`. Ese archivo era un volcado crudo de la base: los títulos
 *   eran los nombres de columna (`artcodigo`, `grudescrip`, `artpreciomino`),
 *   los importes venían sin separador de miles, los dólares con cuatro
 *   decimales sin formato, y el costo desconocido venía como `-1`.
 *
 *   Acá se arma el mismo informe con los datos del ERP. Se mantiene el orden
 *   y el sentido de las columnas para que el contador no tenga que aprender
 *   una planilla nueva, pero con los títulos escritos en castellano y los
 *   números formateados.
 *
 * ── LO QUE NO SE PUDO MAPEAR, Y POR QUÉ NO IMPORTA ────────────────────────
 *   El archivo viejo traía cuatro listas de precios (`artprecio1` a
 *   `artprecio4`) y en las 993 filas las cuatro venían en cero: no las usan.
 *   Acá van las dos que el ERP sí maneja, mayorista y distribuidor, y las
 *   otras dos no se inventan.
 *
 * ── EL -1 ─────────────────────────────────────────────────────────────────
 *   En el archivo viejo un costo de `-1` quería decir "sin costo cargado", y
 *   así salía impreso: una columna con menos-unos que alguien tenía que saber
 *   leer. Acá la celda queda vacía, que es lo que significa, y el encabezado
 *   del informe lo aclara.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface StockConPreciosRow {
  codigo: string | null;
  sku: string;
  nombre: string;
  rubro: string | null;
  unidad: string;
  costo_gs: string | number | null;
  /** Costo de la factura del proveedor, si se carga en dólares (script 32). */
  costo_usd: string | number | null;
  descuento_pct: string | number | null;
  precio_minorista: string | number | null;
  precio_mayorista: string | number | null;
  precio_distribuidor: string | number | null;
  existencia: string | number;
  stock_minimo: string | number;
  valorizado_gs: string | number | null;
  sucursal_nombre: string | null;
}

export interface StockConPreciosResultado {
  filas: StockConPreciosRow[];
  /** Guaraníes por dólar vigente al armar el informe. null si no hay cotización cargada. */
  cotizacion: number | null;
}

/**
 * Trae el stock valorizado con sus precios de lista.
 *
 * `sucursalId` null trae todas las sucursales y agrega la columna que dice de
 * cuál es cada renglón; con una sucursal la columna no se repite mil veces en
 * la pantalla, va en el encabezado.
 *
 * Se incluyen los productos con existencia en cero a propósito: la planilla
 * sirve tanto para valorizar como para ver qué hay que reponer, y un producto
 * agotado es justamente el que interesa en el segundo caso.
 */
export async function getStockConPrecios(
  schemaRaw: string,
  empresaId: string,
  sucursalId: string | null
): Promise<StockConPreciosResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool de Postgres no disponible");

  const tProd = quoteSchemaTable(schema, "productos");
  const tCat = quoteSchemaTable(schema, "categorias_productos");
  const tSuc = quoteSchemaTable(schema, "sucursales");
  const tTc = quoteSchemaTable(schema, "tipos_cambio");

  const params: unknown[] = [empresaId];
  let filtroSucursal = "";
  if (sucursalId) {
    params.push(sucursalId);
    filtroSucursal = `AND p.sucursal_id = $2::uuid`;
  }

  const { rows } = await pool.query<StockConPreciosRow>(
    `SELECT p.codigo_barras                      AS codigo,
            p.sku                                AS sku,
            p.nombre                             AS nombre,
            c.nombre                             AS rubro,
            p.unidad_medida                      AS unidad,
            NULLIF(p.costo_promedio, 0)          AS costo_gs,
            p.costo_usd                          AS costo_usd,
            -- Misma regla que descuentoEfectivo() en src/lib/precios/ficha.ts:
            -- el descuento del artículo REEMPLAZA al del rubro, no se suman ni
            -- se toma el mayor. Acá estaba con GREATEST, que daba otra cosa:
            -- un artículo al 2% en un rubro al 4% salía con 4%, al revés de lo
            -- que dice la ficha del producto.
            CASE WHEN COALESCE(p.descuento_pct, 0) > 0
                 THEN p.descuento_pct
                 ELSE COALESCE(c.descuento_pct, 0)
            END                                  AS descuento_pct,
            NULLIF(p.precio_venta, 0)            AS precio_minorista,
            NULLIF(p.precio_mayorista, 0)        AS precio_mayorista,
            NULLIF(p.precio_distribuidor, 0)     AS precio_distribuidor,
            COALESCE(p.stock_actual, 0)          AS existencia,
            COALESCE(p.stock_minimo, 0)          AS stock_minimo,
            NULLIF(COALESCE(p.stock_actual, 0) * COALESCE(p.costo_promedio, 0), 0) AS valorizado_gs,
            s.nombre                             AS sucursal_nombre
       FROM ${tProd} p
       LEFT JOIN ${tCat} c ON c.id = p.categoria_principal_id
       LEFT JOIN ${tSuc} s ON s.id = p.sucursal_id
      WHERE p.empresa_id = $1::uuid
        AND COALESCE(p.activo, true) = true
        ${filtroSucursal}
      ORDER BY c.nombre NULLS LAST, p.nombre`,
    params
  );

  // La cotización se busca aparte y no con un JOIN: es una sola fila para
  // todo el informe, y en el JOIN habría que repetir el `ORDER BY ... LIMIT 1`
  // por producto. Si la tabla todavía no existe (falta correr 20_tipos_cambio)
  // el informe sale igual, sin las columnas en dólares.
  let cotizacion: number | null = null;
  try {
    const { rows: tc } = await pool.query<{ venta: string }>(
      `SELECT venta FROM ${tTc}
        WHERE empresa_id = $1::uuid AND moneda = 'USD' AND vigente_desde <= now()
        ORDER BY vigente_desde DESC LIMIT 1`,
      [empresaId]
    );
    const v = Number(tc[0]?.venta);
    if (Number.isFinite(v) && v > 0) cotizacion = v;
  } catch {
    cotizacion = null;
  }

  return { filas: rows, cotizacion };
}
