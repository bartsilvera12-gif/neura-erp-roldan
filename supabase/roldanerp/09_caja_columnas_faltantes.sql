-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 09 · Columnas que le faltaban a `caja_movimientos`
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   El script 05 creó la tabla con las columnas del formulario, pero el módulo
--   de caja que vino de `neura-erp-hierros` lee y escribe varias más. La que
--   rompía era `anulado_at`: se consulta al abrir la caja (para sumar solo los
--   movimientos no anulados), así que la apertura fallaba con
--   "column caja_movimientos.anulado_at does not exist".
--
--   Las que faltaban y para qué sirven:
--     venta_id         — ata el movimiento a la venta que lo generó
--     usuario_email    — quién lo cargó, para el listado del turno
--     anulado_at       — baja lógica: el movimiento se tacha, no se borra
--     anulado_por_id   — quién lo anuló
--     anulado_motivo   — por qué
--
--   Además `medio_pago` aceptaba cuatro valores y esta instancia también cobra
--   con cheque, que no es efectivo y no puede contarse como tal en el arqueo.
--
-- Requiere 01, 02 y 05 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'caja_movimientos'
      AND c.relkind IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.caja_movimientos`. Correr primero el script 05.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS venta_id       uuid        NULL,
  ADD COLUMN IF NOT EXISTS usuario_email  text        NULL,
  ADD COLUMN IF NOT EXISTS anulado_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS anulado_por_id uuid        NULL,
  ADD COLUMN IF NOT EXISTS anulado_motivo text        NULL;

COMMENT ON COLUMN roldanerp.caja_movimientos.venta_id IS
  'Venta que originó el movimiento. NULL en los movimientos cargados a mano.';
COMMENT ON COLUMN roldanerp.caja_movimientos.anulado_at IS
  'Baja lógica. Un movimiento anulado se muestra tachado y no suma al arqueo.';

-- Los anulados se filtran en cada consulta del turno: conviene el índice parcial.
CREATE INDEX IF NOT EXISTS caja_movimientos_activos_idx
  ON roldanerp.caja_movimientos (caja_id)
  WHERE anulado_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) `medio_pago` tiene que aceptar `cheque`
--    El CHECK se reemplaza en vez de agregarse: dos CHECK sobre la misma
--    columna se evalúan en AND y el viejo seguiría rechazando 'cheque'.
-- ---------------------------------------------------------------------------
DO $medio$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c      ON c.oid = con.conrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp'
      AND c.relname = 'caja_movimientos'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%medio_pago%'
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.caja_movimientos DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'CHECK viejo de medio_pago eliminado: %', r.conname;
  END LOOP;

  ALTER TABLE roldanerp.caja_movimientos
    ADD CONSTRAINT caja_movimientos_medio_pago_chk
    CHECK (medio_pago IN ('efectivo', 'tarjeta', 'transferencia', 'cheque', 'otro'));
END
$medio$;

-- ---------------------------------------------------------------------------
-- 3) Chequeo final: que estén todas las columnas que el código espera
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  r     record;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'id', 'empresa_id', 'caja_id', 'tipo', 'concepto', 'monto', 'medio_pago',
      'usuario_id', 'usuario_email', 'observacion', 'created_at',
      'venta_id', 'anulado_at', 'anulado_por_id', 'anulado_motivo'
    ]) AS col
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'roldanerp'
        AND table_name   = 'caja_movimientos'
        AND column_name  = r.col
    ) THEN
      v_bad := v_bad || ' ' || r.col;
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Siguen faltando columnas en caja_movimientos:%', v_bad;
  END IF;

  RAISE NOTICE 'caja_movimientos tiene las 15 columnas que el módulo necesita.';
END
$check$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Sin esto la API sigue sirviendo el esquema viejo y las columnas nuevas no
-- existen para la app, aunque sí estén en la base.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
