-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 16 · Que los cobros y los pagos queden atados al turno de caja
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Los módulos de Cobros y de Pagos a proveedores nacieron sueltos de Caja:
--   registraban el movimiento de dinero en su propia tabla y la caja no se
--   enteraba. Al cerrar el turno faltaba justamente esa plata y el arqueo
--   nunca cuadraba.
--
--   El código ya escribe el movimiento espejo en `caja_movimientos`. Este
--   script agrega las dos columnas con las que ese movimiento recuerda de qué
--   cobro o de qué pago salió, para poder auditarlo después.
--
--   `caja_movimientos.tipo` también tiene que aceptar los dos tipos que se
--   usan: 'ingreso' para el cobro y 'egreso' para el pago.
--
-- Requiere 05 y 09 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.caja_movimientos') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.caja_movimientos`. Correr primero el script 05.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) De dónde salió el movimiento
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS cobro_id uuid NULL,
  ADD COLUMN IF NOT EXISTS pago_id  uuid NULL;

COMMENT ON COLUMN roldanerp.caja_movimientos.cobro_id IS
  'Cobro a cliente que generó este ingreso. NULL si el movimiento no viene de un cobro.';
COMMENT ON COLUMN roldanerp.caja_movimientos.pago_id IS
  'Pago a proveedor que generó este egreso. NULL si el movimiento no viene de un pago.';

CREATE INDEX IF NOT EXISTS caja_movimientos_cobro_idx
  ON roldanerp.caja_movimientos (cobro_id) WHERE cobro_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS caja_movimientos_pago_idx
  ON roldanerp.caja_movimientos (pago_id) WHERE pago_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) `tipo` tiene que aceptar ingreso y egreso
--
--    Se reemplaza el CHECK en vez de agregar otro: dos CHECK sobre la misma
--    columna se evalúan en AND. Se conservan los valores que ya existan en la
--    tabla, para no invalidar movimientos cargados.
-- ---------------------------------------------------------------------------
DO $tipo$
DECLARE
  r          record;
  v_actuales text[];
  v_lista    text;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT tipo), ARRAY[]::text[])
    INTO v_actuales
    FROM roldanerp.caja_movimientos
   WHERE tipo IS NOT NULL;

  SELECT string_agg(quote_literal(t), ', ' ORDER BY t) INTO v_lista
    FROM (
      SELECT unnest(v_actuales) AS t
      UNION
      SELECT unnest(ARRAY['ingreso', 'egreso', 'retiro', 'ajuste'])
    ) AS x
   WHERE t IS NOT NULL AND btrim(t) <> '';

  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c      ON c.oid = con.conrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp'
      AND c.relname = 'caja_movimientos'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ~* '\mtipo\M'
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.caja_movimientos DROP CONSTRAINT %I', r.conname);
  END LOOP;

  EXECUTE format(
    'ALTER TABLE roldanerp.caja_movimientos ADD CONSTRAINT caja_movimientos_tipo_chk CHECK (tipo IN (%s))',
    v_lista
  );
  RAISE NOTICE 'caja_movimientos.tipo acepta: %', v_lista;
END
$tipo$;

-- ---------------------------------------------------------------------------
-- 3) Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  r     record;
  v_bad text := '';
BEGIN
  FOR r IN SELECT unnest(ARRAY['cobro_id', 'pago_id', 'devolucion_id', 'venta_id', 'usuario_email']) AS c
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='roldanerp' AND table_name='caja_movimientos' AND column_name = r.c
    ) THEN
      v_bad := v_bad || ' ' || r.c;
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Faltan columnas en caja_movimientos:%  (revisar scripts 09 y 15)', v_bad;
  END IF;
  RAISE NOTICE 'Listo: los cobros y los pagos ya pueden quedar atados al turno de caja.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
