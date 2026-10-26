-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 19 · Punto 1.4 · Historial de ajustes de stock
-- ============================================================================
--
-- QUÉ PIDE EL PUNTO
--   Un listado independiente SOLO de ajustes (no de todos los movimientos) con
--   código único, fecha, hora, usuario, producto, cantidad sumada o restada y
--   motivo. Filtrable por fecha.
--
-- QUÉ FALTABA EN LA BASE
--
--   1. EL CÓDIGO ÚNICO no existía. Un ajuste solo tenía su uuid, que no sirve
--      para que dos personas hablen del mismo ajuste por teléfono.
--
--   2. EL SIGNO SE PERDÍA. `movimientos_inventario.cantidad` se guarda SIEMPRE
--      en valor absoluto: un ajuste de 95 a 90 quedaba como "5", sin decir que
--      era una baja. Se podía deducir leyendo el motivo cuando el motivo lo
--      decía ("Ajuste manual ... (95 → 90)"), pero uno escrito a mano como
--      "CONTEO FISICO" era indescifrable. Un historial de ajustes que no dice
--      si sumó o restó no sirve para auditar nada.
--
--   Se agregan tres columnas: el delta con signo y el stock antes y después.
--   Con las tres, cada fila del historial se explica sola sin leer el motivo.
--
-- EL CÓDIGO LO PONE UN TRIGGER, no la aplicación: los ajustes se crean desde
-- tres lugares distintos (la pantalla de movimientos, la ficha del producto y
-- la importación de Excel) y si cada uno tuviera que acordarse de numerar,
-- tarde o temprano uno se olvida y queda un ajuste sin código.
--
-- QUÉ CUENTA COMO AJUSTE: `origen = 'ajuste_manual'`, NO `tipo = 'AJUSTE'`.
--   La importación de Excel registra sus correcciones de stock como ENTRADA o
--   SALIDA con origen ajuste_manual. Numerar por `tipo` las dejaría afuera del
--   historial, y son ajustes igual: cambian el stock sin una compra ni una
--   venta detrás.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.movimientos_inventario') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.movimientos_inventario`.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.movimientos_inventario
  ADD COLUMN IF NOT EXISTS numero_ajuste   text    NULL,
  ADD COLUMN IF NOT EXISTS cantidad_delta  numeric NULL,
  ADD COLUMN IF NOT EXISTS stock_antes     numeric NULL,
  ADD COLUMN IF NOT EXISTS stock_despues   numeric NULL;

COMMENT ON COLUMN roldanerp.movimientos_inventario.numero_ajuste IS
  'Punto 1.4. Codigo unico legible del ajuste (AJ-000001). Lo asigna un trigger. NULL en los movimientos que no son ajustes.';
COMMENT ON COLUMN roldanerp.movimientos_inventario.cantidad_delta IS
  'Punto 1.4. Cantidad CON SIGNO: positivo sumo, negativo resto. `cantidad` guarda el valor absoluto y pierde esa informacion.';
COMMENT ON COLUMN roldanerp.movimientos_inventario.stock_antes IS
  'Stock del producto antes del movimiento. Hace que la fila se explique sola.';
COMMENT ON COLUMN roldanerp.movimientos_inventario.stock_despues IS
  'Stock del producto despues del movimiento.';

-- ---------------------------------------------------------------------------
-- Numeración
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS roldanerp.ajuste_numero_seq;

CREATE OR REPLACE FUNCTION roldanerp.asignar_numero_ajuste()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Solo los ajustes se numeran. Una venta o una compra ya tienen su propio
  -- comprobante; numerarlas aca seria inventar un segundo numero para lo mismo.
  -- El criterio es el ORIGEN, no el tipo: la importacion de Excel registra sus
  -- correcciones como ENTRADA/SALIDA con origen ajuste_manual.
  IF NEW.origen = 'ajuste_manual' AND (NEW.numero_ajuste IS NULL OR btrim(NEW.numero_ajuste) = '') THEN
    NEW.numero_ajuste := 'AJ-' || lpad(nextval('roldanerp.ajuste_numero_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_numero_ajuste ON roldanerp.movimientos_inventario;
CREATE TRIGGER trg_numero_ajuste
  BEFORE INSERT ON roldanerp.movimientos_inventario
  FOR EACH ROW
  EXECUTE FUNCTION roldanerp.asignar_numero_ajuste();

-- Unico por empresa. Parcial: los movimientos que no son ajustes tienen NULL y
-- no deben chocar entre si.
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_numero_ajuste_uq
  ON roldanerp.movimientos_inventario (empresa_id, numero_ajuste)
  WHERE numero_ajuste IS NOT NULL;

-- El listado se filtra por fecha y es lo unico que consulta.
CREATE INDEX IF NOT EXISTS movimientos_ajustes_fecha_idx
  ON roldanerp.movimientos_inventario (empresa_id, sucursal_id, fecha DESC)
  WHERE origen = 'ajuste_manual';

-- ---------------------------------------------------------------------------
-- Ajustes que ya existían
-- ---------------------------------------------------------------------------

-- 1) Numerarlos. En orden cronologico, para que el codigo siga el orden real
--    en que ocurrieron y no el orden en que la base los devuelva.
DO $backfill_num$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM roldanerp.movimientos_inventario
     WHERE origen = 'ajuste_manual' AND numero_ajuste IS NULL
     ORDER BY fecha, created_at, id
  LOOP
    UPDATE roldanerp.movimientos_inventario
       SET numero_ajuste = 'AJ-' || lpad(nextval('roldanerp.ajuste_numero_seq')::text, 6, '0')
     WHERE id = r.id;
  END LOOP;
END
$backfill_num$;

-- 2) Recuperar el signo donde se pueda.
--
--    Los ajustes hechos desde la ficha del producto dejan el motivo con el
--    patron "(antes → despues)", que lo escribe la aplicacion y es confiable.
--    De ahi salen el delta y los dos stocks exactos.
--
--    Los de la importacion de Excel dejan "prev=X new=Y", que se resuelve
--    igual con el segundo UPDATE.
--
--    Los de motivo escrito a mano ("CONTEO FISICO") no se pueden recuperar:
--    quedan en NULL a proposito. La pantalla los muestra como signo
--    desconocido en vez de adivinar un signo que podria ser el equivocado.
UPDATE roldanerp.movimientos_inventario m
   SET stock_antes   = (regexp_match(m.referencia, '\((\d+(?:[.,]\d+)?)\s*→\s*(\d+(?:[.,]\d+)?)\)'))[1]::numeric,
       stock_despues = (regexp_match(m.referencia, '\((\d+(?:[.,]\d+)?)\s*→\s*(\d+(?:[.,]\d+)?)\)'))[2]::numeric,
       cantidad_delta =
         (regexp_match(m.referencia, '\((\d+(?:[.,]\d+)?)\s*→\s*(\d+(?:[.,]\d+)?)\)'))[2]::numeric
         - (regexp_match(m.referencia, '\((\d+(?:[.,]\d+)?)\s*→\s*(\d+(?:[.,]\d+)?)\)'))[1]::numeric
 WHERE m.origen = 'ajuste_manual'
   AND m.cantidad_delta IS NULL
   AND m.referencia ~ '\(\d+(?:[.,]\d+)?\s*→\s*\d+(?:[.,]\d+)?\)';

-- 3) Los de la importacion de Excel: "prev=X new=Y".
UPDATE roldanerp.movimientos_inventario m
   SET stock_antes   = (regexp_match(m.referencia, 'prev=(-?\d+(?:[.,]\d+)?)\s+new=(-?\d+(?:[.,]\d+)?)'))[1]::numeric,
       stock_despues = (regexp_match(m.referencia, 'prev=(-?\d+(?:[.,]\d+)?)\s+new=(-?\d+(?:[.,]\d+)?)'))[2]::numeric,
       cantidad_delta =
         (regexp_match(m.referencia, 'prev=(-?\d+(?:[.,]\d+)?)\s+new=(-?\d+(?:[.,]\d+)?)'))[2]::numeric
         - (regexp_match(m.referencia, 'prev=(-?\d+(?:[.,]\d+)?)\s+new=(-?\d+(?:[.,]\d+)?)'))[1]::numeric
 WHERE m.origen = 'ajuste_manual'
   AND m.cantidad_delta IS NULL
   AND m.referencia ~ 'prev=-?\d+(?:[.,]\d+)?\s+new=-?\d+(?:[.,]\d+)?';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_falta  text := '';
  v_sin    int;
  v_total  int;
  v_signo  int;
BEGIN
  FOR v_falta IN
    SELECT c FROM unnest(ARRAY['numero_ajuste','cantidad_delta','stock_antes','stock_despues']) c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='roldanerp' AND table_name='movimientos_inventario' AND column_name=c)
  LOOP
    RAISE EXCEPTION 'Falta la columna %', v_falta;
  END LOOP;

  SELECT count(*) INTO v_total FROM roldanerp.movimientos_inventario WHERE origen='ajuste_manual';
  SELECT count(*) INTO v_sin   FROM roldanerp.movimientos_inventario WHERE origen='ajuste_manual' AND numero_ajuste IS NULL;
  SELECT count(*) INTO v_signo FROM roldanerp.movimientos_inventario WHERE origen='ajuste_manual' AND cantidad_delta IS NULL;

  IF v_sin > 0 THEN
    RAISE EXCEPTION 'Quedaron % ajustes sin numero', v_sin;
  END IF;

  RAISE NOTICE '1.4 listo: % ajustes numerados. % sin signo recuperable (motivo escrito a mano).', v_total, v_signo;
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
