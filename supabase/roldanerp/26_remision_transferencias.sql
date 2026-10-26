-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 26 · Módulo 8 · Número de remisión de las transferencias
-- ============================================================================
--
-- Punto 8.1: "Transferencias entre sucursales con número único de remisión no
-- repetible y filtros."
--
-- ── QUÉ ES LA REMISIÓN Y POR QUÉ NO ALCANZA EL NÚMERO DE TRANSFERENCIA ─────
--   El TRF-XXXXXX nace cuando la sucursal PIDE la mercadería. La remisión es
--   otro documento: el papel que viaja con la mercadería cuando se DESPACHA, y
--   es el que se muestra si para el camión un control en la ruta.
--
--   Son dos momentos distintos y hace falta distinguirlos: un pedido puede
--   quedar aprobado y nunca despacharse, y en ese caso no hay remisión porque
--   nunca salió nada. Por eso `numero_remision` es NULL hasta el despacho y no
--   se calcula desde el número de transferencia.
--
-- ── NO REPETIBLE, DE VERDAD ───────────────────────────────────────────────
--   "No repetible" en un documento que puede terminar en manos de la DNIT no
--   se garantiza con un contador en la aplicación: dos despachos simultáneos
--   leen el mismo máximo y escriben el mismo número. El que lo garantiza es el
--   índice único de acá abajo. El código además toma un advisory lock por
--   empresa para que el segundo despacho espere en vez de fallar, pero si el
--   lock no alcanzara, el índice rechaza el duplicado: es mejor que el
--   despacho falle que que salgan dos camiones con la misma remisión.
--
--   El índice es PARCIAL (WHERE numero_remision IS NOT NULL) porque todas las
--   transferencias sin despachar tienen NULL, y en un índice único común dos
--   NULL no chocan pero el índice se llena de filas que no sirven.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) La tabla tiene que existir (viene del esquema clonado, script 01)
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF to_regclass('roldanerp.transferencias_inventario') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.transferencias_inventario. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) La columna
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.transferencias_inventario
  ADD COLUMN IF NOT EXISTS numero_remision text NULL;

ALTER TABLE roldanerp.transferencias_inventario
  ADD COLUMN IF NOT EXISTS remision_emitida_at timestamptz NULL;

COMMENT ON COLUMN roldanerp.transferencias_inventario.numero_remision IS
  'REM-XXXXXX del documento que viaja con la mercadería. NULL hasta el despacho.';
COMMENT ON COLUMN roldanerp.transferencias_inventario.remision_emitida_at IS
  'Cuándo se emitió la remisión. Es el momento del despacho, guardado aparte '
  'para que siga estando si el despacho se corrigiera.';

-- Nada de texto vacío: un '' pasaría el índice único una sola vez y después
-- haría fallar el segundo despacho con un error que no se entiende.
ALTER TABLE roldanerp.transferencias_inventario
  DROP CONSTRAINT IF EXISTS transferencias_remision_no_vacia;
ALTER TABLE roldanerp.transferencias_inventario
  ADD CONSTRAINT transferencias_remision_no_vacia CHECK (
    numero_remision IS NULL OR btrim(numero_remision) <> ''
  );

-- ---------------------------------------------------------------------------
-- 2) Duplicados previos (si alguien ya cargó remisiones a mano)
-- ---------------------------------------------------------------------------
DO $dup$
DECLARE v_dup text;
BEGIN
  SELECT string_agg(DISTINCT numero_remision, ', ') INTO v_dup
    FROM (
      SELECT empresa_id, numero_remision
        FROM roldanerp.transferencias_inventario
       WHERE numero_remision IS NOT NULL
       GROUP BY empresa_id, numero_remision
      HAVING count(*) > 1
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay remisiones repetidas: %. Hay que resolverlas antes de poner el indice unico.', v_dup;
  END IF;
END
$dup$;

-- ---------------------------------------------------------------------------
-- 3) Los índices únicos
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_transferencias_remision
  ON roldanerp.transferencias_inventario (empresa_id, numero_remision)
  WHERE numero_remision IS NOT NULL;

-- El número de transferencia también: el código lo asume ("el índice único
-- (empresa_id, numero) es el respaldo final") y conviene que exista de verdad.
DO $trf$
DECLARE v_dup text;
BEGIN
  SELECT string_agg(DISTINCT numero, ', ') INTO v_dup
    FROM (
      SELECT empresa_id, numero
        FROM roldanerp.transferencias_inventario
       WHERE numero IS NOT NULL
       GROUP BY empresa_id, numero
      HAVING count(*) > 1
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE WARNING
      'Hay numeros de transferencia repetidos: %. No se crea el indice unico de numero.', v_dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_transferencias_numero
      ON roldanerp.transferencias_inventario (empresa_id, numero)
      WHERE numero IS NOT NULL;
  END IF;
END
$trf$;

-- Para los filtros por fecha de despacho (punto 8.1).
CREATE INDEX IF NOT EXISTS ix_transferencias_despachada
  ON roldanerp.transferencias_inventario (empresa_id, despachada_at DESC);

-- ---------------------------------------------------------------------------
-- 4) Backfill: las que ya se despacharon antes de este script
-- ---------------------------------------------------------------------------
--   Una transferencia despachada sin remisión no se puede inventar hacia
--   atrás, pero tampoco puede quedar sin nada: se le asigna un REM- siguiendo
--   el orden en que se despacharon, que es el orden en que habrían salido los
--   papeles. Van marcadas con la fecha de despacho, no con la de hoy.
DO $backfill$
DECLARE
  r         record;
  v_emp     uuid := NULL;
  v_next    int  := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.empresa_id, t.despachada_at
      FROM roldanerp.transferencias_inventario t
     WHERE t.despachada_at IS NOT NULL
       AND t.numero_remision IS NULL
     ORDER BY t.empresa_id, t.despachada_at, t.id
  LOOP
    IF v_emp IS DISTINCT FROM r.empresa_id THEN
      v_emp := r.empresa_id;
      SELECT COALESCE(MAX(
               CASE WHEN numero_remision ~ '^REM-[0-9]+$'
                    THEN (substring(numero_remision from 5))::int ELSE 0 END
             ), 0)
        INTO v_next
        FROM roldanerp.transferencias_inventario
       WHERE empresa_id = v_emp;
    END IF;

    v_next := v_next + 1;
    UPDATE roldanerp.transferencias_inventario
       SET numero_remision      = 'REM-' || lpad(v_next::text, 6, '0'),
           remision_emitida_at  = r.despachada_at,
           updated_at           = now()
     WHERE id = r.id;
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 5) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_sin  int;
  v_idx  int;
BEGIN
  SELECT count(*) INTO v_sin
    FROM roldanerp.transferencias_inventario
   WHERE despachada_at IS NOT NULL AND numero_remision IS NULL;
  IF v_sin > 0 THEN
    RAISE EXCEPTION 'Quedaron % transferencias despachadas sin remision.', v_sin;
  END IF;

  SELECT count(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'roldanerp' AND indexname = 'ux_transferencias_remision';
  IF v_idx = 0 THEN
    RAISE EXCEPTION 'No quedo creado el indice unico de remision.';
  END IF;

  RAISE NOTICE '8.1 listo: numero_remision con indice unico por empresa.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
