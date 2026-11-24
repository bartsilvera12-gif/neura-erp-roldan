-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 104 · Aprobación y recepción de compras
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: las compras, como las órdenes de compra, tienen que
--   aprobarlas dos administradores, y después marcarse «En tránsito» y
--   «Recibido». Recién al marcar «Recibido» la mercadería entra al stock y se
--   recalcula el costo.
--
-- QUÉ HACE
--   Agrega a roldanerp.compras:
--     stock_aplicado        si la compra ya sumó al stock. Las compras que ya
--                           existen quedan en true (ya sumaron al guardarse).
--     recepcion             null (compras de antes), 'pendiente',
--                           'en_transito' o 'recibida'.
--     aprobada_1_* / aprobada_2_*   quién aprobó y cuándo.
--     en_transito_* / recibida_*    quién marcó cada paso y cuándo.
--     ubicacion_destino_id  el depósito elegido al cargar (para sumar al recibir).
--     precio_venta_usd      el precio en dólares de la línea (para el producto al recibir).
--
-- No cambia ninguna compra existente: todas siguen como estaban, con su stock.
-- Idempotente: se puede correr más de una vez.
-- ============================================================================

ALTER TABLE roldanerp.compras
  ADD COLUMN IF NOT EXISTS stock_aplicado       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS recepcion            text,
  ADD COLUMN IF NOT EXISTS aprobada_1_por       uuid,
  ADD COLUMN IF NOT EXISTS aprobada_1_nombre    text,
  ADD COLUMN IF NOT EXISTS aprobada_1_at        timestamptz,
  ADD COLUMN IF NOT EXISTS aprobada_2_por       uuid,
  ADD COLUMN IF NOT EXISTS aprobada_2_nombre    text,
  ADD COLUMN IF NOT EXISTS aprobada_2_at        timestamptz,
  ADD COLUMN IF NOT EXISTS en_transito_nombre   text,
  ADD COLUMN IF NOT EXISTS en_transito_at       timestamptz,
  ADD COLUMN IF NOT EXISTS recibida_nombre      text,
  ADD COLUMN IF NOT EXISTS recibida_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ubicacion_destino_id uuid,
  ADD COLUMN IF NOT EXISTS precio_venta_usd     numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compras_recepcion_check'
       AND conrelid = 'roldanerp.compras'::regclass
  ) THEN
    ALTER TABLE roldanerp.compras
      ADD CONSTRAINT compras_recepcion_check
      CHECK (recepcion IS NULL OR recepcion IN ('pendiente', 'en_transito', 'recibida'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
