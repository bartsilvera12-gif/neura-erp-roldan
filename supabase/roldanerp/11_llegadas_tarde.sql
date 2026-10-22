-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 11 · Llegadas tarde en el control horario
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   El control horario registraba la hora de entrada, pero no había contra qué
--   compararla: ningún empleado tenía horario previsto, así que una llegada
--   tarde era indistinguible de una puntual.
--
--   Se agregan tres columnas:
--     empleados.hora_entrada_prevista — a qué hora debería entrar.
--     empleados.tolerancia_minutos    — margen antes de contar la tardanza.
--     empleado_fichajes.minutos_tarde — cuánto llegó tarde ese día.
--
--   `minutos_tarde` se guarda calculado en el momento del fichaje, no se
--   deduce al mostrar: si mañana cambia el horario del empleado, el historial
--   tiene que seguir diciendo lo que pasó aquel día.
--
--   NULL en `minutos_tarde` significa "no corresponde evaluarlo" (el empleado
--   no tiene horario cargado). Cero significa "llegó en hora". Son cosas
--   distintas y conviene poder distinguirlas.
--
-- DESPUÉS DE CORRER ESTE SCRIPT
--   Cargar el horario de entrada de cada empleado en su ficha. Mientras esté
--   vacío, el sistema no marca tardanzas para esa persona.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.empleados`. Revisar el clon del script 01.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleado_fichajes' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.empleado_fichajes`. Revisar el clon del script 01.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.empleados
  ADD COLUMN IF NOT EXISTS hora_entrada_prevista time NULL,
  ADD COLUMN IF NOT EXISTS tolerancia_minutos    integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN roldanerp.empleados.hora_entrada_prevista IS
  'Hora a la que debería entrar. NULL = no se evalúan tardanzas para este empleado.';
COMMENT ON COLUMN roldanerp.empleados.tolerancia_minutos IS
  'Margen en minutos antes de contar la llegada como tarde.';

ALTER TABLE roldanerp.empleado_fichajes
  ADD COLUMN IF NOT EXISTS minutos_tarde integer NULL;

COMMENT ON COLUMN roldanerp.empleado_fichajes.minutos_tarde IS
  'Minutos de tardanza de ese día, ya descontada la tolerancia. NULL = el empleado no tenía horario cargado; 0 = llegó en hora.';

-- La consulta típica es "tardanzas del mes", así que conviene el índice parcial.
CREATE INDEX IF NOT EXISTS empleado_fichajes_tarde_idx
  ON roldanerp.empleado_fichajes (empresa_id, fecha)
  WHERE minutos_tarde > 0;

-- La tolerancia no puede ser negativa: sería adelantar el horario por la puerta
-- de atrás, y nadie lo leería así al configurarlo.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados'
      AND con.conname = 'empleados_tolerancia_chk'
  ) THEN
    ALTER TABLE roldanerp.empleados
      ADD CONSTRAINT empleados_tolerancia_chk CHECK (tolerancia_minutos >= 0);
  END IF;
END
$chk$;

DO $fin$
DECLARE v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='roldanerp' AND table_name='empleados' AND column_name='hora_entrada_prevista'
  ) THEN v_faltan := v_faltan || ' empleados.hora_entrada_prevista'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='roldanerp' AND table_name='empleado_fichajes' AND column_name='minutos_tarde'
  ) THEN v_faltan := v_faltan || ' empleado_fichajes.minutos_tarde'; END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'Faltan columnas:%', v_faltan;
  END IF;
  RAISE NOTICE 'Llegadas tarde listas. Cargá el horario de entrada en la ficha de cada empleado.';
END
$fin$;

COMMIT;

NOTIFY pgrst, 'reload schema';
