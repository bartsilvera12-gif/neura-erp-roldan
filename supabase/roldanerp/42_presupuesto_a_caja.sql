-- ===========================================================================
-- 42 · Mandar un presupuesto aprobado a la caja
-- ---------------------------------------------------------------------------
-- El vendedor aprueba el presupuesto y después tiene que avisarle al cajero
-- de palabra, o ir él mismo hasta la caja. Con esto lo empuja desde la
-- pantalla y al cajero le aparece en una lista de "pendientes de cobro".
--
-- Se guarda CUÁNDO se mandó y QUIÉN lo mandó, no solo un sí/no: cuando algo
-- se cobra mal, la pregunta siempre es quién lo pasó y a qué hora.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.presupuestos.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS enviado_a_caja_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS enviado_a_caja_por    text        NULL;

COMMENT ON COLUMN roldanerp.presupuestos.enviado_a_caja_at IS
  'Cuándo se mandó a cobrar. NULL = todavía no se mandó. Se limpia si se '
  'cancela el envío.';
COMMENT ON COLUMN roldanerp.presupuestos.enviado_a_caja_por IS
  'Nombre de quien lo mandó a la caja, al momento de mandarlo.';

-- La cola del cajero: aprobados, mandados, y todavía sin cobrar.
CREATE INDEX IF NOT EXISTS presupuestos_cola_caja_idx
  ON roldanerp.presupuestos (empresa_id, sucursal_id, enviado_a_caja_at DESC)
  WHERE enviado_a_caja_at IS NOT NULL AND convertido_venta_id IS NULL;

COMMIT;

DO $check$
DECLARE v_pend int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos'
       AND column_name='enviado_a_caja_at'
  ) THEN
    RAISE EXCEPTION 'Falta la columna presupuestos.enviado_a_caja_at';
  END IF;

  SELECT count(*) INTO v_pend FROM roldanerp.presupuestos
   WHERE estado = 'aprobado' AND convertido_venta_id IS NULL;
  RAISE NOTICE 'Script 42 listo. Hay % presupuestos aprobados sin cobrar; ninguno mandado a caja todavía.', v_pend;
END
$check$;

NOTIFY pgrst, 'reload schema';
