-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 74 · Horario semanal y domicilio (ciudad y barrio) del empleado
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Integrar en la ficha del empleado su horario de entrada y salida" y
--   "las ciudades y los barrios que tiene el gobierno".
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────
--   empleados.horario_semanal  jsonb. Una entrada por día que trabaja, con la
--                              clave del día de la semana (0 = domingo …
--                              6 = sábado):
--                                {"1": {"entrada": "07:00", "salida": "17:00"},
--                                 "6": {"entrada": "07:00", "salida": "11:00"}}
--                              El día que no está, no trabaja. El sábado corto
--                              es lo común en la casa; con una sola hora de
--                              entrada no se podía decir.
--   empleados.ciudad / barrio  Texto, elegidos del listado del INE (censo
--                              2022) en la pantalla, o escritos a mano si no
--                              están.
--
-- ── LO QUE TOCA DE LOS DATOS ───────────────────────────────────────────────
--   A quien tiene `hora_entrada_prevista` cargada y ningún horario semanal, le
--   arma uno de lunes a sábado con esa entrada y sin salida: es lo que se sabía
--   hasta ahora. Se completa la salida desde la ficha.
--
-- Idempotente: se puede correr dos veces. La segunda no cambia nada.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.empleados') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.empleados.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.empleados ADD COLUMN IF NOT EXISTS horario_semanal jsonb;
ALTER TABLE roldanerp.empleados ADD COLUMN IF NOT EXISTS ciudad text;
ALTER TABLE roldanerp.empleados ADD COLUMN IF NOT EXISTS barrio text;

COMMENT ON COLUMN roldanerp.empleados.horario_semanal IS
  'Horario por día de la semana: {"0".."6": {"entrada": "HH:MM", "salida": "HH:MM"}} (0 = domingo). '
  'Día ausente = no trabaja. La tardanza se mide contra la entrada del día.';
COMMENT ON COLUMN roldanerp.empleados.ciudad IS 'Ciudad (distrito) del domicilio, del listado del INE.';
COMMENT ON COLUMN roldanerp.empleados.barrio IS 'Barrio o localidad del domicilio, del listado del INE.';

-- Lo que se sabía: la hora de entrada, de lunes a sábado.
DO $migrar$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'empleados' AND column_name = 'hora_entrada_prevista'
  ) THEN
    UPDATE roldanerp.empleados e
       SET horario_semanal = (
             SELECT jsonb_object_agg(d::text, jsonb_build_object('entrada', to_char(e.hora_entrada_prevista::time, 'HH24:MI'), 'salida', NULL))
               FROM generate_series(1, 6) AS d
           )
     WHERE e.horario_semanal IS NULL
       AND e.hora_entrada_prevista IS NOT NULL;
  END IF;
END
$migrar$;

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.empleados)                                   AS empleados,
  (SELECT count(*) FROM roldanerp.empleados WHERE horario_semanal IS NOT NULL) AS con_horario,
  (SELECT count(*) FROM roldanerp.empleados WHERE ciudad IS NOT NULL)          AS con_ciudad,
  (SELECT count(*) FROM roldanerp.empleados WHERE barrio IS NOT NULL)          AS con_barrio;
