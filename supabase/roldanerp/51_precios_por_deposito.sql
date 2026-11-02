-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 51 · Precios y remarcación por depósito
-- ============================================================================
--
-- ── LO QUE HAY HOY ────────────────────────────────────────────────────────
--   El precio vive en el producto, y el producto pertenece a una SUCURSAL.
--   Los depósitos (`inventario_ubicaciones`) existen aparte y lo único que se
--   guarda por depósito es el stock. O sea: dos depósitos de la misma
--   sucursal no pueden tener precios distintos.
--
-- ── LO QUE AGREGA ESTE SCRIPT ─────────────────────────────────────────────
--   Una tabla de EXCEPCIONES por depósito. No reemplaza al precio del
--   producto: lo pisa cuando hay una fila.
--
--   POR QUÉ EXCEPCIONES Y NO UNA LISTA COMPLETA POR DEPÓSITO: con una lista
--   completa, cada producto nuevo habría que cargarlo tantas veces como
--   depósitos haya, y un precio actualizado en el producto no llegaría a
--   ningún depósito. Con excepciones, lo normal —el mismo precio en todos
--   lados— no se carga dos veces, y se escribe solo lo que de verdad es
--   distinto.
--
--   `NULL` en una columna significa "usá el del producto". Así se puede
--   tener un depósito con otro precio pero la misma remarcación, o al revés.
--
-- ── POR QUÉ SOLO EL PRECIO DE LISTA ───────────────────────────────────────
--   Los niveles B y C se calculan sobre el precio de lista (+5% y +10%), no
--   se guardan por separado. Guardar los tres por depósito sería guardar dos
--   veces lo mismo y abrir la puerta a que queden diciendo cosas distintas.
--   `precio_usd` también entra, porque un producto cotizado en dólares toma
--   su precio de ahí.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.productos.';
  END IF;
  IF to_regclass('roldanerp.inventario_ubicaciones') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.inventario_ubicaciones (depósitos).';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.producto_precios_deposito (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  producto_id   uuid NOT NULL,
  ubicacion_id  uuid NOT NULL,
  -- NULL = usar el del producto. Es la diferencia entre "este depósito cobra
  -- otro precio" y "a este depósito nunca le pusieron precio propio".
  precio_venta  numeric NULL,
  precio_usd    numeric NULL,
  markup_pct    numeric NULL,
  nota          text NULL,
  actualizado_por text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Un solo precio por producto y depósito. Sin esto, dos filas para el mismo
-- par dejarían el precio a suerte de cuál lea primero la consulta.
CREATE UNIQUE INDEX IF NOT EXISTS producto_precios_deposito_uniq
  ON roldanerp.producto_precios_deposito (empresa_id, producto_id, ubicacion_id);

-- La consulta del mostrador: todos los precios propios de UN depósito, para
-- pisar la lista de productos de una sola vez.
CREATE INDEX IF NOT EXISTS producto_precios_deposito_ubicacion_idx
  ON roldanerp.producto_precios_deposito (empresa_id, ubicacion_id);

COMMENT ON TABLE roldanerp.producto_precios_deposito IS
  'Excepciones de precio por depósito. Una fila pisa el precio del producto '
  'solo en ese depósito; NULL en una columna significa usar el del producto.';

DO $chk$
BEGIN
  -- Un precio negativo no es un precio. Cero sí se permite: hay mercadería que
  -- se entrega sin cargo y conviene poder decirlo en vez de inventar un peso.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'producto_precios_deposito_no_negativos'
       AND conrelid = 'roldanerp.producto_precios_deposito'::regclass
  ) THEN
    ALTER TABLE roldanerp.producto_precios_deposito
      ADD CONSTRAINT producto_precios_deposito_no_negativos
      CHECK (
        (precio_venta IS NULL OR precio_venta >= 0) AND
        (precio_usd   IS NULL OR precio_usd   >= 0) AND
        (markup_pct   IS NULL OR markup_pct   >= -100)
      );
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------
-- 2) De qué depósito salió cada cosa
-- ---------------------------------------------------------------------------
--   Hasta ahora ni la venta ni el movimiento de inventario guardaban el
--   depósito: el stock por depósito se movía, pero después no había forma de
--   saber de cuál había salido.
--
--   POR QUÉ IMPORTA, CON UN CASO CONCRETO: se anula una venta. El stock
--   global vuelve, pero ¿a qué depósito? Sin este dato hay que elegir uno al
--   azar o no devolverlo, y en los dos casos el desglose por depósito queda
--   mintiendo. Con la columna, vuelve a donde salió.
ALTER TABLE roldanerp.ventas
  ADD COLUMN IF NOT EXISTS ubicacion_id uuid NULL;

COMMENT ON COLUMN roldanerp.ventas.ubicacion_id IS
  'Depósito del que salió la mercadería de esta venta. NULL en las ventas '
  'anteriores al multidepósito o cuando no se eligió depósito.';

ALTER TABLE roldanerp.movimientos_inventario
  ADD COLUMN IF NOT EXISTS ubicacion_id uuid NULL;

COMMENT ON COLUMN roldanerp.movimientos_inventario.ubicacion_id IS
  'Depósito donde ocurrió el movimiento. NULL si no se eligió o si es '
  'anterior a esta columna.';

CREATE INDEX IF NOT EXISTS movimientos_inventario_ubicacion_idx
  ON roldanerp.movimientos_inventario (empresa_id, ubicacion_id)
  WHERE ubicacion_id IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_filas int;
  v_depos int;
BEGIN
  IF to_regclass('roldanerp.producto_precios_deposito') IS NULL THEN
    RAISE EXCEPTION 'No quedó creada producto_precios_deposito.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='roldanerp' AND indexname='producto_precios_deposito_uniq'
  ) THEN
    RAISE EXCEPTION 'Falta el índice único (producto, depósito).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='ventas' AND column_name='ubicacion_id'
  ) THEN
    RAISE EXCEPTION 'Falta ventas.ubicacion_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='movimientos_inventario' AND column_name='ubicacion_id'
  ) THEN
    RAISE EXCEPTION 'Falta movimientos_inventario.ubicacion_id';
  END IF;

  SELECT count(*) INTO v_filas FROM roldanerp.producto_precios_deposito;
  SELECT count(*) INTO v_depos FROM roldanerp.inventario_ubicaciones WHERE activo IS TRUE;

  RAISE NOTICE 'Script 51 listo. Precios propios de depósito cargados: %. Depósitos activos: %.', v_filas, v_depos;
  RAISE NOTICE 'Se cargan en Inventario → Precios por depósito. Sin filas, todo sigue igual que antes.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
