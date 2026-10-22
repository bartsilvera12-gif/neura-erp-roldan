-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 13 · Módulo de Devoluciones de venta
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Caja → Devoluciones y el botón "Devolver" dentro de una venta fallaban con
--     relation "roldanerp.devoluciones_venta" does not exist
--     relation "roldanerp.factura_autoimpresor" does not exist
--
--   No es que el clon las haya perdido: esas tablas NO existen tampoco en el
--   schema `mexicana` del que se clonó. El código de devoluciones vino del
--   fork de ferretería, que sí las tenía. Acá se crean.
--
--   `factura_autoimpresor` es del régimen de autoimpresor, que esta empresa no
--   usa. Se crea igual, vacía, porque el flujo de devolución la consulta para
--   saber si la venta tiene factura fiscal emitida. Vacía, la respuesta es
--   "no tiene", que es la correcta acá.
--
-- Requiere 01, 02 y 05 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero el script 01.';
  END IF;
  IF to_regclass('roldanerp.ventas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.ventas`. Revisar el clon del script 01.';
  END IF;
  IF to_regclass('roldanerp.cajas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.cajas`. Correr primero el script 05.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Cabecera de la devolución
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.devoluciones_venta (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL,
  -- Correlativo propio: DEV-000001. El código lo calcula leyendo el máximo.
  numero_devolucion      text NOT NULL,
  venta_id               uuid NOT NULL,
  -- Snapshot de la venta: si después se edita o anula, la devolución tiene
  -- que seguir diciendo contra qué se hizo.
  venta_numero_control   text NULL,
  venta_fecha            timestamptz NULL,
  cliente_id             uuid NULL,
  -- 'devolucion' = se devuelve plata o se anula; 'cambio' = sale otra mercadería.
  tipo                   text NOT NULL,
  resolucion             text NULL,
  estado                 text NOT NULL DEFAULT 'confirmada'
                         CHECK (estado IN ('confirmada', 'anulada')),
  motivo                 text NULL,
  total_devuelto         numeric NOT NULL DEFAULT 0,
  total_entregado        numeric NOT NULL DEFAULT 0,
  -- entregado - devuelto. Positivo: el cliente paga la diferencia.
  diferencia             numeric NOT NULL DEFAULT 0,
  metodo_reembolso       text NULL,
  caja_id                uuid NULL,
  caja_movimiento_id     uuid NULL,
  requiere_nota_credito  boolean NOT NULL DEFAULT false,
  -- Evita duplicar la devolución si el navegador reintenta el POST.
  idempotency_key        text NULL,
  anulada_at             timestamptz NULL,
  anulada_motivo         text NULL,
  created_by             uuid NULL,
  usuario_nombre         text NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devoluciones_venta_venta_fk
    FOREIGN KEY (venta_id) REFERENCES roldanerp.ventas(id) ON DELETE RESTRICT
);

COMMENT ON TABLE roldanerp.devoluciones_venta IS
  'Devoluciones y cambios sobre una venta. Una fila por operación; el detalle va en devoluciones_venta_items.';

CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_venta_numero_uq
  ON roldanerp.devoluciones_venta (empresa_id, numero_devolucion);

-- La clave de idempotencia solo aplica cuando viene: índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_venta_idem_uq
  ON roldanerp.devoluciones_venta (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS devoluciones_venta_venta_idx
  ON roldanerp.devoluciones_venta (empresa_id, venta_id);

CREATE INDEX IF NOT EXISTS devoluciones_venta_fecha_idx
  ON roldanerp.devoluciones_venta (empresa_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) Qué se devolvió
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.devoluciones_venta_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  devolucion_id     uuid NOT NULL,
  venta_item_id     uuid NULL,
  producto_id       uuid NULL,
  producto_nombre   text NULL,
  sku               text NULL,
  cantidad_vendida  numeric NOT NULL DEFAULT 0,
  cantidad_devuelta numeric NOT NULL DEFAULT 0,
  precio_unitario   numeric NOT NULL DEFAULT 0,
  tipo_iva          text NULL,
  monto_iva         numeric NOT NULL DEFAULT 0,
  total_devuelto    numeric NOT NULL DEFAULT 0,
  -- En qué estado vuelve: condiciona si se reintegra al stock.
  condicion         text NULL,
  reintegra_stock   boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devoluciones_venta_items_dev_fk
    FOREIGN KEY (devolucion_id) REFERENCES roldanerp.devoluciones_venta(id) ON DELETE CASCADE
);

COMMENT ON COLUMN roldanerp.devoluciones_venta_items.reintegra_stock IS
  'false cuando la mercadería vuelve dañada: se acredita al cliente pero no entra al stock.';

CREATE INDEX IF NOT EXISTS devoluciones_venta_items_dev_idx
  ON roldanerp.devoluciones_venta_items (devolucion_id);

-- Para "cuánto de este ítem ya se devolvió", que el flujo consulta por venta.
CREATE INDEX IF NOT EXISTS devoluciones_venta_items_venta_item_idx
  ON roldanerp.devoluciones_venta_items (empresa_id, venta_item_id);

-- ---------------------------------------------------------------------------
-- 3) Qué se entregó a cambio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.devoluciones_venta_cambios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  devolucion_id   uuid NOT NULL,
  producto_id     uuid NULL,
  producto_nombre text NULL,
  sku             text NULL,
  cantidad        numeric NOT NULL DEFAULT 0,
  precio_unitario numeric NOT NULL DEFAULT 0,
  tipo_iva        text NULL,
  monto_iva       numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devoluciones_venta_cambios_dev_fk
    FOREIGN KEY (devolucion_id) REFERENCES roldanerp.devoluciones_venta(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS devoluciones_venta_cambios_dev_idx
  ON roldanerp.devoluciones_venta_cambios (devolucion_id);

-- ---------------------------------------------------------------------------
-- 4) factura_autoimpresor — vacía a propósito
--
--    El flujo de devolución pregunta si la venta tiene factura fiscal emitida.
--    Esta empresa no usa autoimpresor, así que la tabla queda vacía y la
--    respuesta es siempre "no tiene", que es lo correcto. Se crea igual para
--    que la consulta no reviente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.factura_autoimpresor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  venta_id        uuid NULL,
  numero_factura  text NULL,
  timbrado_numero text NULL,
  fecha_emision   timestamptz NULL,
  total           numeric NULL,
  anulada_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.factura_autoimpresor IS
  'Facturas del régimen autoimpresor. Vacía en esta instancia: existe para que el flujo de devoluciones pueda consultarla.';

CREATE INDEX IF NOT EXISTS factura_autoimpresor_venta_idx
  ON roldanerp.factura_autoimpresor (empresa_id, venta_id);

-- ---------------------------------------------------------------------------
-- 5) updated_at automático en la cabecera
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roldanerp.touch_devoluciones_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS devoluciones_venta_touch ON roldanerp.devoluciones_venta;
CREATE TRIGGER devoluciones_venta_touch
  BEFORE UPDATE ON roldanerp.devoluciones_venta
  FOR EACH ROW EXECUTE FUNCTION roldanerp.touch_devoluciones_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Chequeo: todas las columnas que el código espera
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  r     record;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT 'devoluciones_venta' AS t, unnest(ARRAY[
      'id','empresa_id','numero_devolucion','venta_id','venta_numero_control','venta_fecha',
      'cliente_id','tipo','resolucion','estado','motivo','total_devuelto','total_entregado',
      'diferencia','metodo_reembolso','caja_id','caja_movimiento_id','requiere_nota_credito',
      'idempotency_key','anulada_at','anulada_motivo','created_by','usuario_nombre','created_at'
    ]) AS c
    UNION ALL
    SELECT 'devoluciones_venta_items', unnest(ARRAY[
      'empresa_id','devolucion_id','venta_item_id','producto_id','producto_nombre','sku',
      'cantidad_vendida','cantidad_devuelta','precio_unitario','tipo_iva','monto_iva',
      'total_devuelto','condicion','reintegra_stock'
    ])
    UNION ALL
    SELECT 'devoluciones_venta_cambios', unnest(ARRAY[
      'empresa_id','devolucion_id','producto_id','producto_nombre','sku',
      'cantidad','precio_unitario','tipo_iva','monto_iva','total'
    ])
    UNION ALL
    SELECT 'factura_autoimpresor', unnest(ARRAY['empresa_id','venta_id'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'roldanerp' AND table_name = r.t AND column_name = r.c
    ) THEN
      v_bad := v_bad || ' ' || r.t || '.' || r.c;
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Faltan columnas:%', v_bad;
  END IF;
  RAISE NOTICE 'Devoluciones listo: 4 tablas con todas las columnas que el modulo usa.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
