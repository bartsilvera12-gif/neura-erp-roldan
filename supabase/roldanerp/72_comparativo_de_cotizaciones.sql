-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 72 · Comparativo de cotizaciones entre proveedores
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Agregar comparativo de cotizaciones entre proveedores."
--
-- ── EL MODELO ──────────────────────────────────────────────────────────────
--   Un PEDIDO DE COTIZACIÓN tiene varios artículos y se le manda a varios
--   proveedores. Cada uno contesta con un precio por artículo —o no contesta
--   alguno—. El comparativo es la grilla: artículos en las filas, proveedores
--   en las columnas.
--
--      cotizaciones          la cabecera: COT-000001, fecha, estado
--      cotizacion_items      qué se pide: artículo, cantidad, unidad
--      cotizacion_precios    qué contestó cada proveedor por cada artículo
--
--   `cotizacion_precios` es la grilla propiamente dicha: una fila por cruce.
--   Lo que no está es "no lo cotizó", y por eso la ausencia de fila ES un
--   dato: un cero sería "lo regala".
--
-- ── POR QUÉ NO SE GUARDA EL GANADOR ────────────────────────────────────────
--   El comparativo se calcula al leerlo, no se congela. Si mañana se corrige
--   un precio mal tipeado, el ganador cambia solo. Guardar el veredicto
--   obligaría a recalcularlo a mano y, cuando alguien se olvidara, la pantalla
--   mostraría un ganador que ya no lo es.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.proveedores') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.proveedores.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.cotizaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  numero_control text NOT NULL,
  fecha          date NOT NULL DEFAULT current_date,
  -- abierta = se están cargando precios · cerrada = ya se decidió
  estado         text NOT NULL DEFAULT 'abierta',
  observaciones  text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cotizaciones_estado_chk CHECK (estado IN ('abierta', 'cerrada', 'anulada'))
);

COMMENT ON TABLE roldanerp.cotizaciones IS
  'Pedido de cotización: una lista de artículos que se le pasa a varios '
  'proveedores para comparar precios antes de comprar.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizaciones_numero
  ON roldanerp.cotizaciones (empresa_id, numero_control);

CREATE TABLE IF NOT EXISTS roldanerp.cotizacion_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  cotizacion_id uuid NOT NULL REFERENCES roldanerp.cotizaciones(id) ON DELETE CASCADE,
  -- Puede no existir en el catálogo: a veces se cotiza algo que todavía no se
  -- dio de alta como producto.
  producto_id   uuid,
  descripcion   text NOT NULL,
  cantidad      numeric NOT NULL DEFAULT 1,
  unidad        text NOT NULL DEFAULT 'UNIDAD',
  orden         int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_items_cot
  ON roldanerp.cotizacion_items (empresa_id, cotizacion_id, orden);

CREATE TABLE IF NOT EXISTS roldanerp.cotizacion_precios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  cotizacion_id   uuid NOT NULL REFERENCES roldanerp.cotizaciones(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES roldanerp.cotizacion_items(id) ON DELETE CASCADE,
  proveedor_id    uuid NOT NULL,
  precio_unitario numeric NOT NULL DEFAULT 0,
  plazo_dias      int,
  observacion     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.cotizacion_precios IS
  'Un precio por cruce artículo × proveedor. La AUSENCIA de fila significa '
  '"no lo cotizó", que no es lo mismo que cero: un cero diría que lo regala, '
  'y ganaría siempre la comparación.';

-- Un proveedor cotiza un artículo UNA vez. Sin esto, dos cargas del mismo
-- precio darían dos filas y el total del proveedor saldría duplicado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_precio
  ON roldanerp.cotizacion_precios (empresa_id, item_id, proveedor_id);

CREATE INDEX IF NOT EXISTS idx_cotizacion_precios_cot
  ON roldanerp.cotizacion_precios (empresa_id, cotizacion_id);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.cotizaciones)                        AS cotizaciones,
  (SELECT count(*) FROM roldanerp.cotizaciones WHERE estado='abierta') AS abiertas,
  (SELECT count(*) FROM roldanerp.cotizacion_items)                    AS articulos_pedidos,
  (SELECT count(*) FROM roldanerp.cotizacion_precios)                  AS precios_cargados,
  (SELECT count(DISTINCT proveedor_id) FROM roldanerp.cotizacion_precios) AS proveedores_que_cotizaron;
