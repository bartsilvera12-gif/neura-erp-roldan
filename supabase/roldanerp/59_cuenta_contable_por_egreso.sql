-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 59 · A qué cuenta contable va cada clase de egreso de caja
-- ============================================================================
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────
--   Los egresos de caja ya se clasifican —pago a proveedor, flete, sueldo,
--   servicios, impuestos, insumos, mantenimiento, retiro de socio, otros— pero
--   esa clase no está atada a ninguna cuenta del plan. Para el contador todos
--   los egresos del mes terminan en una sola bolsa, y separar el sueldo del
--   flete y del impuesto es trabajo a mano sobre el extracto.
--
-- ── QUÉ AGREGA ────────────────────────────────────────────────────────────
--   `caja_egreso_cuentas`: una cuenta del plan por cada clase de egreso.
--   Se configura en Configuración → Cuentas de los egresos de caja.
--
-- ── POR QUÉ UNA TABLA Y NO COLUMNAS EN `contabilidad_config` ──────────────
--   Las clases de egreso cambian: hoy son nueve y mañana la casa quiere
--   separar "combustible" de "flete". Con una columna por clase, cada clase
--   nueva es un script nuevo y un deploy. Con una fila por clase, se agrega
--   desde la pantalla.
--
-- ── NO SE INVENTA NINGUNA CUENTA ──────────────────────────────────────────
--   La tabla queda vacía: cada casa tiene su plan y sus números. Mientras una
--   clase no tenga cuenta asignada, el egreso se registra igual —la caja no
--   se frena por una configuración contable— y la pantalla muestra cuáles
--   faltan.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

CREATE TABLE IF NOT EXISTS roldanerp.caja_egreso_cuentas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  /** La clase de egreso, tal como la guarda `caja_movimientos.tipo_egreso`. */
  tipo_egreso text NOT NULL,
  /** La cuenta del plan. ON DELETE RESTRICT: borrar una cuenta que está en
   *  uso dejaría egresos apuntando a la nada, y el error al borrar es más
   *  barato que descubrirlo tres meses después cerrando el ejercicio. */
  cuenta_id   uuid NOT NULL REFERENCES roldanerp.plan_cuentas(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Una sola cuenta por clase y empresa: con dos, ninguna gana y el asiento
-- saldría distinto según el orden en que se lean.
CREATE UNIQUE INDEX IF NOT EXISTS caja_egreso_cuentas_uq
  ON roldanerp.caja_egreso_cuentas (empresa_id, tipo_egreso);

COMMENT ON TABLE roldanerp.caja_egreso_cuentas IS
  'A que cuenta del plan va cada clase de egreso de caja. Vacia = esa clase todavia no esta imputada.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_tab int; v_filas int; v_clases int;
BEGIN
  SELECT count(*) INTO v_tab FROM information_schema.tables
   WHERE table_schema = 'roldanerp' AND table_name = 'caja_egreso_cuentas';
  IF v_tab <> 1 THEN
    RAISE EXCEPTION 'Script 59: no se creo caja_egreso_cuentas';
  END IF;

  SELECT count(*) INTO v_filas FROM roldanerp.caja_egreso_cuentas;

  -- `tipo_egreso` llega con el script 42. Si todavia no esta, el conteo se
  -- saltea: una verificacion que revienta hace parecer que el script fallo
  -- cuando la tabla se creo bien.
  v_clases := -1;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'caja_movimientos'
       AND column_name = 'tipo_egreso'
  ) THEN
    EXECUTE 'SELECT count(DISTINCT tipo_egreso) FROM roldanerp.caja_movimientos WHERE tipo_egreso IS NOT NULL'
      INTO v_clases;
  END IF;

  RAISE NOTICE 'Script 59 listo.';
  RAISE NOTICE '  Clases de egreso ya imputadas: %.', v_filas;
  IF v_clases >= 0 THEN
    RAISE NOTICE '  Clases usadas en movimientos existentes: %.', v_clases;
  END IF;
  IF v_filas = 0 THEN
    RAISE NOTICE '  Falta elegir las cuentas en Configuracion -> Cuentas de los egresos de caja.';
  END IF;
END
$verif$;

NOTIFY pgrst, 'reload schema';
