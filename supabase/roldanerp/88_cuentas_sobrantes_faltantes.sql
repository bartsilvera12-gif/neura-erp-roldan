-- ============================================================================
-- 88 · Sobrantes y faltantes de caja → cuentas contables
-- ============================================================================
--
-- Cuando en una venta en efectivo no se da el vuelto (sobrante) o se acepta
-- de menos (faltante), la diferencia queda como ajuste de la caja. Con este
-- script, además, se asienta en la contabilidad:
--
--   Sobrante:  Debe  Caja                 / Haber  Sobrantes de caja
--   Faltante:  Debe  Faltantes de caja    / Haber  Caja
--
-- Las dos cuentas se eligen en Configuración → Contable. Si no están
-- elegidas, la diferencia se registra en la caja igual y se asienta después,
-- al guardar la configuración.
--
-- Se puede correr más de una vez.
-- ============================================================================

ALTER TABLE roldanerp.configuracion_contable
  ADD COLUMN IF NOT EXISTS cuenta_sobrantes_caja_id uuid REFERENCES roldanerp.plan_cuentas(id),
  ADD COLUMN IF NOT EXISTS cuenta_faltantes_caja_id uuid REFERENCES roldanerp.plan_cuentas(id);

COMMENT ON COLUMN roldanerp.configuracion_contable.cuenta_sobrantes_caja_id IS
  'Cuenta (ingreso) donde se asientan los sobrantes de caja de las ventas en efectivo.';
COMMENT ON COLUMN roldanerp.configuracion_contable.cuenta_faltantes_caja_id IS
  'Cuenta (pérdida) donde se asientan los faltantes de caja de las ventas en efectivo.';

-- Si asientos_contables limita origen_tipo con un CHECK, se le agrega
-- 'caja_diferencia' conservando los valores que ya admitía.
DO $$
DECLARE
  r record;
  valores text;
BEGIN
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'roldanerp'
       AND t.relname = 'asientos_contables'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%origen_tipo%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%caja_diferencia%'
  LOOP
    SELECT string_agg(DISTINCT quote_literal(m[1]), ', ')
      INTO valores
      FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m;
    EXECUTE format('ALTER TABLE roldanerp.asientos_contables DROP CONSTRAINT %I', r.conname);
    EXECUTE format(
      'ALTER TABLE roldanerp.asientos_contables ADD CONSTRAINT %I CHECK (origen_tipo IS NULL OR origen_tipo IN (%s))',
      r.conname,
      concat_ws(', ', valores, quote_literal('caja_diferencia'))
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
