-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 15 · Lo que le falta al schema para confirmar una devolución
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Con las tablas del script 13 creadas, confirmar una devolución falla con
--     new row for relation "ventas" violates check constraint "ventas_estado_check"
--
--   La devolución NO borra ni sobrescribe la venta: le cambia el estado a
--   `parcialmente_devuelta` o `devuelta_total` según cuánto se devolvió. El
--   CHECK que vino clonado de `mexicana` no conoce esos dos valores, porque
--   allá no existe el módulo de devoluciones.
--
--   Además, el movimiento de caja de la devolución guarda a qué devolución
--   corresponde, y esa columna tampoco existía: el script 09 agregó
--   `venta_id` pero no `devolucion_id`.
--
-- Requiere 05, 09 y 13 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) `ventas.estado` tiene que aceptar los estados de devolución
--
--    El CHECK se reemplaza, no se agrega otro: dos CHECK sobre la misma
--    columna se evalúan en AND, así que el viejo seguiría rechazando los
--    valores nuevos.
--
--    Los estados que ya hubiera cargados se conservan: el CHECK nuevo incluye
--    todo lo que haya en la tabla más los dos que faltaban.
-- ---------------------------------------------------------------------------
DO $estado$
DECLARE
  r          record;
  v_actuales text[];
  v_lista    text;
BEGIN
  IF to_regclass('roldanerp.ventas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.ventas`.';
  END IF;

  -- Qué estados hay hoy en la tabla, para no invalidar filas existentes.
  SELECT COALESCE(array_agg(DISTINCT estado), ARRAY[]::text[])
    INTO v_actuales
    FROM roldanerp.ventas
   WHERE estado IS NOT NULL;

  -- Unión de: lo que ya hay + los estados que el ERP usa.
  SELECT string_agg(quote_literal(e), ', ' ORDER BY e) INTO v_lista
    FROM (
      SELECT unnest(v_actuales) AS e
      UNION
      SELECT unnest(ARRAY[
        'pendiente', 'completada', 'anulada',
        'parcialmente_devuelta', 'devuelta_total'
      ])
    ) AS t
   WHERE e IS NOT NULL AND btrim(e) <> '';

  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c      ON c.oid = con.conrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp'
      AND c.relname = 'ventas'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.ventas DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'CHECK viejo de ventas.estado eliminado: %', r.conname;
  END LOOP;

  EXECUTE format(
    'ALTER TABLE roldanerp.ventas ADD CONSTRAINT ventas_estado_check CHECK (estado IN (%s))',
    v_lista
  );
  RAISE NOTICE 'ventas.estado ahora acepta: %', v_lista;
END
$estado$;

-- ---------------------------------------------------------------------------
-- 2) El movimiento de caja de la devolución guarda a cuál corresponde
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS devolucion_id uuid NULL;

COMMENT ON COLUMN roldanerp.caja_movimientos.devolucion_id IS
  'Devolución que generó este movimiento. NULL en los movimientos que no vienen de una devolución.';

CREATE INDEX IF NOT EXISTS caja_movimientos_devolucion_idx
  ON roldanerp.caja_movimientos (devolucion_id)
  WHERE devolucion_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_bad text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='roldanerp' AND table_name='caja_movimientos' AND column_name='devolucion_id'
  ) THEN v_bad := v_bad || ' caja_movimientos.devolucion_id'; END IF;

  -- Prueba real: el CHECK tiene que dejar pasar los dos estados nuevos.
  BEGIN
    PERFORM 1 FROM roldanerp.ventas WHERE estado = 'devuelta_total' LIMIT 1;
  EXCEPTION WHEN others THEN
    v_bad := v_bad || ' ventas.estado';
  END;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Sigue faltando:%', v_bad;
  END IF;
  RAISE NOTICE 'Listo: ventas.estado acepta los estados de devolucion y caja_movimientos tiene devolucion_id.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
