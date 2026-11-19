-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 95 · Retenciones en la caja
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   El cliente pidió que en «Movimiento» de la caja se quite «Ajuste» y se
--   agreguen «Retención», «Cobranza» (en lugar de «Ingreso») y «Anticipo».
--
--   - Cobranza es el mismo `ingreso` de siempre, con otro nombre en pantalla.
--   - Anticipo se guarda en la tabla `anticipos`, como cualquier anticipo.
--   - Retención es un tipo nuevo: el comprobante de retención que deja el
--     cliente (factura, monto, cliente). No es efectivo, así que no entra al
--     arqueo del cajón. Este script deja que `caja_movimientos.tipo` acepte
--     'retencion'.
--
--   Sin este script la retención igual se registra, como una cobranza con
--   medio «otro» y el concepto «Retención …»; con el script queda con su tipo.
--
-- Solo escribe en `roldanerp`. Idempotente. No borra ni cambia datos.
-- ============================================================================

BEGIN;

DO $tipo$
DECLARE
  r          record;
  v_actuales text[];
  v_lista    text;
BEGIN
  IF to_regclass('roldanerp.caja_movimientos') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.caja_movimientos. Correr primero el script 05.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT tipo), ARRAY[]::text[])
    INTO v_actuales
    FROM roldanerp.caja_movimientos
   WHERE tipo IS NOT NULL;

  SELECT string_agg(quote_literal(t), ', ' ORDER BY t) INTO v_lista
    FROM (
      SELECT unnest(v_actuales) AS t
      UNION
      SELECT unnest(ARRAY['ingreso', 'egreso', 'retiro', 'ajuste', 'retencion'])
    ) AS x
   WHERE t IS NOT NULL AND btrim(t) <> '';

  -- Se reemplaza el CHECK: dos CHECK sobre la misma columna se evalúan en AND.
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c      ON c.oid = con.conrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp'
      AND c.relname = 'caja_movimientos'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ~* '\mtipo\M'
      AND pg_get_constraintdef(con.oid) !~* 'tipo_egreso'
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

COMMIT;
