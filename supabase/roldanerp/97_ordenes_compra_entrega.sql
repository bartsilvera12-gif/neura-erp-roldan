-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 97 · Órdenes de compra: fecha de llegada, condición y su compra
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Pedido del cliente para las órdenes de compra:
--     - la fecha en que va a llegar la mercadería (al llegar esa fecha la
--       orden cuenta como recibida sola);
--     - contado o crédito;
--     - «Cargar factura»: la orden pasa a una compra con sus datos, y queda
--       anotado qué compra la facturó;
--     - poder marcarla como recibida o en tránsito a mano.
--
--   Sin este script las órdenes se crean igual, sin esos datos.
--
-- Solo escribe en `roldanerp`. Idempotente. No borra ni cambia datos.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.ordenes_compra') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.ordenes_compra.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.ordenes_compra
  ADD COLUMN IF NOT EXISTS fecha_entrega  date NULL,
  ADD COLUMN IF NOT EXISTS condicion      text NULL,
  ADD COLUMN IF NOT EXISTS compra_numero  text NULL,
  ADD COLUMN IF NOT EXISTS recibida_at    timestamptz NULL;

COMMENT ON COLUMN roldanerp.ordenes_compra.fecha_entrega IS
  'Cuándo llega la mercadería. Llegada la fecha, la orden cuenta como recibida.';
COMMENT ON COLUMN roldanerp.ordenes_compra.condicion IS 'contado | credito';
COMMENT ON COLUMN roldanerp.ordenes_compra.compra_numero IS
  'La compra (numero_control) que se cargó desde esta orden con «Cargar factura».';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_at IS
  'Cuándo se marcó recibida a mano. NULL con estado pendiente = en tránsito.';

COMMIT;
