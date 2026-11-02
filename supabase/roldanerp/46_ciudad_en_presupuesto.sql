-- ===========================================================================
-- 46 · La ciudad del cliente en el presupuesto
-- ---------------------------------------------------------------------------
-- El presupuesto guarda los datos del cliente tal como estaban al emitirlo
-- (nombre, RUC, teléfono, dirección) para que el documento siga siendo fiel
-- aunque después la ficha cambie. Faltaba la ciudad, que en una empresa que
-- despacha con flete no es un dato de adorno: define si se entrega, cuánto
-- cuesta llevar y a quién se le pide el transporte.
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
  ADD COLUMN IF NOT EXISTS cliente_ciudad text NULL;

COMMENT ON COLUMN roldanerp.presupuestos.cliente_ciudad IS
  'Ciudad del cliente al momento de emitir el presupuesto. Copia, no '
  'referencia: si la ficha cambia después, el documento emitido no cambia.';

COMMIT;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos'
       AND column_name='cliente_ciudad'
  ) THEN
    RAISE EXCEPTION 'Falta la columna presupuestos.cliente_ciudad';
  END IF;
  RAISE NOTICE 'Script 46 listo: presupuestos.cliente_ciudad creada.';
END
$check$;

NOTIFY pgrst, 'reload schema';
