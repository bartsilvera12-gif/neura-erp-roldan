-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 55 · La categoría del cliente se mueve sola según lo que compra en el mes
-- ============================================================================
--
-- ── QUÉ AGREGA ────────────────────────────────────────────────────────────
--   1. `categorias_cliente.monto_minimo_mensual`
--        Lo que hay que comprar EN EL MES para entrar en esa categoría.
--        NULL = la categoría no participa del ascenso automático (se asigna a
--        mano y el sistema no la toca).
--
--   2. `clientes_categoria_historial`
--        Un renglón por cada vez que a un cliente le cambió la categoría: de
--        cuál a cuál, en qué período, con cuánto compró y por qué.
--
-- ── POR QUÉ UN HISTORIAL Y NO SOLO EL DATO EN EL CLIENTE ──────────────────
--   `clientes.categoria_cliente_id` dice en qué categoría está HOY. Con eso
--   solo no se puede contestar "¿desde cuándo es mayorista?" ni "¿quién bajó de
--   categoría el mes pasado?", que es justo lo que se mira para saber a quién
--   llamar. Y si la categoría cambia el precio, hay que poder decir con qué
--   categoría se le vendió en una fecha, no con cuál está ahora.
--
-- ── CÓMO SE DECIDE LA CATEGORÍA ───────────────────────────────────────────
--   Se suma lo facturado al cliente en el mes (sin las anuladas) y le toca la
--   categoría con el `monto_minimo_mensual` más alto que ese monto alcanza. Si
--   no alcanza ninguno, queda en la más baja de las que participan.
--
--   El cliente que NO compró en el mes tiene monto 0. Eso no es lo mismo que
--   "no existe": por eso el informe tiene el botón "no compraron", que los
--   lista aparte en vez de mezclarlos con los que compraron poco.
--
-- ── ESTE SCRIPT NO MUEVE NINGÚN CLIENTE ───────────────────────────────────
--   Solo crea la columna y la tabla. Los montos mínimos quedan en NULL: hasta
--   que alguien los cargue desde la pantalla, el ascenso automático no corre y
--   las categorías siguen como están. Poner montos inventados acá sería
--   recategorizar 21.344 clientes con números que nadie decidió.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

ALTER TABLE roldanerp.categorias_cliente
  ADD COLUMN IF NOT EXISTS monto_minimo_mensual numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'categorias_cliente_minimo_chk'
       AND conrelid = 'roldanerp.categorias_cliente'::regclass
  ) THEN
    ALTER TABLE roldanerp.categorias_cliente
      ADD CONSTRAINT categorias_cliente_minimo_chk
      CHECK (monto_minimo_mensual IS NULL OR monto_minimo_mensual >= 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.categorias_cliente.monto_minimo_mensual IS
  'Compra mensual minima para entrar en esta categoria. NULL = no participa del ascenso automatico.';

CREATE TABLE IF NOT EXISTS roldanerp.clientes_categoria_historial (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  cliente_id         uuid NOT NULL REFERENCES roldanerp.clientes(id) ON DELETE CASCADE,
  -- Las categorías NO se borran en cascada: si alguien borra una categoría, el
  -- historial tiene que seguir diciendo que el cliente estuvo ahí. Por eso el
  -- nombre se guarda copiado, además del id.
  categoria_anterior_id     uuid NULL,
  categoria_anterior_nombre text NULL,
  categoria_nueva_id        uuid NULL,
  categoria_nueva_nombre    text NULL,
  /** Mes al que corresponde la decisión, como 'YYYY-MM'. */
  periodo            text NOT NULL,
  /** Lo que el cliente compró en ese mes, sin IVA descontado ni anuladas. */
  monto_periodo      numeric NOT NULL DEFAULT 0,
  /** 'automatico' | 'manual'. Un cambio a mano también se registra. */
  origen             text NOT NULL DEFAULT 'automatico',
  motivo             text NULL,
  usuario_id         uuid NULL,
  usuario_nombre     text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clientes_cat_hist_periodo_chk CHECK (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT clientes_cat_hist_origen_chk  CHECK (origen IN ('automatico', 'manual'))
);

-- Buscar el historial de un cliente, y filtrar por fecha, que es lo que pide
-- la pantalla.
CREATE INDEX IF NOT EXISTS clientes_cat_hist_cliente_idx
  ON roldanerp.clientes_categoria_historial (empresa_id, cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clientes_cat_hist_fecha_idx
  ON roldanerp.clientes_categoria_historial (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clientes_cat_hist_periodo_idx
  ON roldanerp.clientes_categoria_historial (empresa_id, periodo);

-- Un solo cambio automático por cliente y período: si el recálculo del mes se
-- corre dos veces, la segunda no duplica el renglón. Los cambios manuales no
-- entran en la restricción porque en un mismo mes puede haber varios.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_cat_hist_auto_uq
  ON roldanerp.clientes_categoria_historial (empresa_id, cliente_id, periodo)
  WHERE origen = 'automatico';

COMMENT ON TABLE roldanerp.clientes_categoria_historial IS
  'Cada cambio de categoria de un cliente, con la fecha, el periodo y cuanto compro ese mes.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_col int; v_tab int; v_idx int; v_con_minimo int;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema = 'roldanerp' AND table_name = 'categorias_cliente'
     AND column_name = 'monto_minimo_mensual';
  SELECT count(*) INTO v_tab FROM information_schema.tables
   WHERE table_schema = 'roldanerp' AND table_name = 'clientes_categoria_historial';
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'roldanerp' AND indexname = 'clientes_cat_hist_auto_uq';

  IF v_col <> 1 OR v_tab <> 1 OR v_idx <> 1 THEN
    RAISE EXCEPTION 'Script 55 incompleto: columna=% tabla=% indice=%', v_col, v_tab, v_idx;
  END IF;

  SELECT count(*) INTO v_con_minimo FROM roldanerp.categorias_cliente
   WHERE monto_minimo_mensual IS NOT NULL;

  RAISE NOTICE 'Script 55 listo.';
  RAISE NOTICE '  Categorias con monto minimo cargado: %.', v_con_minimo;
  IF v_con_minimo = 0 THEN
    RAISE NOTICE '  Mientras sea 0, NINGUN cliente cambia de categoria solo.';
    RAISE NOTICE '  Los montos se cargan en Clientes -> Categorias.';
  END IF;
END
$verif$;

NOTIFY pgrst, 'reload schema';
