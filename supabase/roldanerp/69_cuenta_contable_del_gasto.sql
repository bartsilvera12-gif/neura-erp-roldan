-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 69 · A qué cuenta contable va cada gasto
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Que vaya a la cuenta de gastos... hay que agregar esas cuentas de
--   contabilidad, o sea que en gastos pueda yo agregar a qué cuenta va."
--
-- ── EL HUECO, EXACTAMENTE ──────────────────────────────────────────────────
--   `gastos` ya tenía `cuenta_contrapartida_id` —DE DÓNDE sale la plata: caja,
--   banco— y `asiento_contable_id`. Lo que no tenía es la otra mitad del
--   asiento: A QUÉ CUENTA se imputa el gasto. Sin eso, un alquiler y un sueldo
--   son lo mismo para la contabilidad, y el contador tiene que clasificarlos a
--   mano uno por uno.
--
--   El plan de cuentas ya está cargado y tiene las cuentas que hacen falta:
--
--      5.2.01  Sueldos y jornales
--      5.2.02  Aporte patronal IPS
--      5.2.03  Alquileres
--      5.2.04  Servicios públicos
--      5.2.05  Fletes y transporte
--      5.2.06  Gastos bancarios
--      5.2.07  Gastos varios
--
--   Faltaba la columna que las ate al gasto, y la pantalla para elegirlas.
--
-- ── POR QUÉ SOLO LAS "ASENTABLES" ──────────────────────────────────────────
--   En el plan hay cuentas de título (5, 5.1, 5.2 "GASTOS OPERATIVOS") que
--   agrupan pero no reciben asientos: están marcadas `asentable = false`. La
--   pantalla ofrece solo las asentables. Imputar a una cuenta de título deja un
--   asiento que el contador va a tener que rehacer.
--
-- ── NO SE PONE UNA CUENTA POR DEFECTO ──────────────────────────────────────
--   Los gastos que ya existen quedan en NULL. Asignarles "Gastos varios" en
--   masa sería inventarles una clasificación: un alquiler mal imputado es peor
--   que uno sin imputar, porque el sin imputar se ve y el mal imputado no.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.gastos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.gastos. Correr antes el script 01.';
  END IF;
  IF to_regclass('roldanerp.plan_cuentas') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.plan_cuentas: el plan de cuentas tiene que existir antes.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.gastos
  ADD COLUMN IF NOT EXISTS cuenta_contable_id uuid;

-- La clave foránea va aparte y tolerante: si ya está, no se duplica.
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'gastos_cuenta_contable_fk'
       AND conrelid = 'roldanerp.gastos'::regclass
  ) THEN
    ALTER TABLE roldanerp.gastos
      ADD CONSTRAINT gastos_cuenta_contable_fk
      FOREIGN KEY (cuenta_contable_id)
      REFERENCES roldanerp.plan_cuentas(id)
      -- ON DELETE SET NULL y no CASCADE: borrar una cuenta del plan no puede
      -- llevarse puesto el gasto. El gasto ocurrió igual.
      ON DELETE SET NULL;
    RAISE NOTICE 'Clave foránea gastos → plan_cuentas creada.';
  ELSE
    RAISE NOTICE 'La clave foránea ya existía.';
  END IF;
END
$fk$;

COMMENT ON COLUMN roldanerp.gastos.cuenta_contable_id IS
  'A qué cuenta del plan se imputa el gasto (el DEBE). La contrapartida —de '
  'dónde salió la plata— es cuenta_contrapartida_id. NULL = sin clasificar.';

CREATE INDEX IF NOT EXISTS idx_gastos_cuenta_contable
  ON roldanerp.gastos (empresa_id, cuenta_contable_id);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                                             AS gastos,
  count(cuenta_contable_id)                            AS con_cuenta,
  count(*) - count(cuenta_contable_id)                 AS sin_clasificar,
  (SELECT count(*) FROM roldanerp.plan_cuentas
    WHERE asentable IS TRUE AND naturaleza = 'D')      AS cuentas_disponibles
FROM roldanerp.gastos;
