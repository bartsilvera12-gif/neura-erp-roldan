-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 58 · A quién se le pagó: el proveedor del egreso de caja
-- ============================================================================
--
-- ── QUÉ AGREGA ────────────────────────────────────────────────────────────
--   `caja_movimientos.proveedor`: el nombre de a quién se le pagó.
--
-- ── POR QUÉ FALTABA ───────────────────────────────────────────────────────
--   El movimiento ya guardaba la CLASE de egreso ('proveedor', 'sueldo',
--   'servicio', 'impuesto', 'otros'), que dice que el egreso fue a un
--   proveedor pero no a CUÁL. Con veinte pagos a proveedores en el mes, el
--   contador tiene una lista de "proveedor · 1.500.000" sin forma de saber a
--   quién, y hay que abrir los comprobantes de a uno para reconstruirlo.
--
--   Se pidió en la reunión: "registrar concepto, proveedor, categoría de
--   egreso, importe, medio de pago, observaciones, comprobante".
--
-- ── POR QUÉ TEXTO Y NO UNA REFERENCIA A `proveedores` ─────────────────────
--   En caja se paga también a quien no está dado de alta: el flete de una vez,
--   el service del portón. Obligar a elegir de una lista haría que se cargue
--   cualquier proveedor con tal de seguir, y el dato quedaría peor que vacío.
--   El campo es libre y opcional; cuando el proveedor existe en el padrón, la
--   pantalla lo sugiere.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS proveedor text NULL;

COMMENT ON COLUMN roldanerp.caja_movimientos.proveedor IS
  'A quien se le pago. Texto libre: en caja se paga tambien a quien no esta dado de alta.';

-- Para el informe de egresos por proveedor del mes.
CREATE INDEX IF NOT EXISTS caja_movimientos_proveedor_idx
  ON roldanerp.caja_movimientos (empresa_id, proveedor)
  WHERE proveedor IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_col int;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema = 'roldanerp' AND table_name = 'caja_movimientos'
     AND column_name = 'proveedor';
  IF v_col <> 1 THEN
    RAISE EXCEPTION 'Script 58: falto crear caja_movimientos.proveedor';
  END IF;
  RAISE NOTICE 'Script 58 listo: los egresos de caja ya pueden decir a quien se le pago.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
