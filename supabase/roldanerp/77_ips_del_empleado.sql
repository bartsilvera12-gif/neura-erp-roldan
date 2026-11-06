-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 77 · El IPS en la ficha del empleado
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "fecha de ingreso de ips poner en la ficha y poner si es sobre sueldo
--    mínimo o no que haya manera de quitarle, salario real y salario puesto
--    en ips y que de ahí descuente el 9%."
--
-- ── POR QUÉ SON DOS SALARIOS Y NO UNO ──────────────────────────────────────
--   Hasta ahora la ficha tenía un solo salario y el 9% del IPS salía de ahí.
--   En la práctica paraguaya no siempre es el mismo número: se le paga al
--   empleado lo que se acordó, y al IPS se le declara otra cifra —muy seguido
--   el salario mínimo—.
--
--   Con un solo campo había que elegir cuál guardar, y las dos opciones
--   estaban mal: con el real, el 9% descontado no coincide con el que figura
--   en la planilla del IPS; con el declarado, el recibo le paga al empleado
--   menos de lo que se le prometió.
--
--     salario_base   lo que se le paga. Es el que ya estaba.
--     salario_ips    lo que se le declara al IPS. NULL = se declara el real.
--
-- ── POR QUÉ EL MÍNIMO ES UN INTERRUPTOR Y NO UN NÚMERO COPIADO ─────────────
--   `ips_sobre_minimo` dice "a este se le declara el mínimo". El monto sale
--   del parámetro de la empresa, así que cuando por decreto sube el mínimo se
--   cambia UN número y todos los que están sobre el mínimo quedan al día.
--
--   Si en cambio se copiara el monto en cada ficha, al subir el mínimo habría
--   que entrar empleado por empleado, y el que se olvidara quedaría declarando
--   por debajo del mínimo legal sin que nada lo avise.
--
--   El interruptor se puede quitar: apagado, vale lo que diga `salario_ips`.
--
-- ── EL SALARIO MÍNIMO NO VIENE CARGADO ─────────────────────────────────────
--   A propósito. Es un número que fija un decreto y cambia; ponerlo acá sería
--   dejar escrito en el código un valor que mañana es falso y que nadie sabría
--   que hay que revisar. Queda en NULL y la pantalla pide cargarlo la primera
--   vez que alguien marca "sobre el mínimo".
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.empleados') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.empleados.';
  END IF;
END
$guard$;

-- ── La ficha ───────────────────────────────────────────────────────────────

-- La fecha en que se lo dio de alta en el IPS. No es la de ingreso a la
-- empresa: se entra un día y se lo inscribe otro, y para la antigüedad en el
-- IPS —que es la que cuenta para la jubilación— vale esta.
ALTER TABLE roldanerp.empleados
  ADD COLUMN IF NOT EXISTS fecha_ingreso_ips date;

-- Lo que se le declara al IPS. NULL = se declara el salario real.
ALTER TABLE roldanerp.empleados
  ADD COLUMN IF NOT EXISTS salario_ips numeric;

-- Si se le declara el salario mínimo. Prendido, manda el parámetro de la
-- empresa y `salario_ips` se ignora.
ALTER TABLE roldanerp.empleados
  ADD COLUMN IF NOT EXISTS ips_sobre_minimo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN roldanerp.empleados.salario_ips IS
  'Lo que se le declara al IPS, que puede ser menor al salario real. NULL = '
  'se declara el real. Si ips_sobre_minimo está en true, manda el salario '
  'mínimo de rrhh_parametros y esta columna no se usa.';

COMMENT ON COLUMN roldanerp.empleados.fecha_ingreso_ips IS
  'Alta en el IPS. Puede ser posterior al ingreso a la empresa.';

-- ── Los parámetros de RRHH ─────────────────────────────────────────────────
-- Una fila por empresa. Hoy guarda el salario mínimo; queda para lo que venga
-- (topes, porcentajes) sin tener que crear una tabla por cada número.
CREATE TABLE IF NOT EXISTS roldanerp.rrhh_parametros (
  empresa_id      uuid PRIMARY KEY,
  -- En guaraníes. NULL = todavía no se cargó.
  salario_minimo  numeric,
  -- Desde cuándo rige, para saber si el que está cargado quedó viejo.
  minimo_vigente_desde date,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.rrhh_parametros IS
  'Los números de RRHH que fija una ley o la casa y cambian con el tiempo. El '
  'salario mínimo vive acá y no copiado en cada ficha: al subir por decreto se '
  'cambia una vez y todos los empleados declarados sobre el mínimo quedan al día.';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.empleados)                                   AS empleados,
  (SELECT count(*) FROM roldanerp.empleados WHERE fecha_ingreso_ips IS NOT NULL) AS con_alta_ips,
  (SELECT count(*) FROM roldanerp.empleados WHERE ips_sobre_minimo)            AS sobre_el_minimo,
  (SELECT count(*) FROM roldanerp.empleados WHERE salario_ips IS NOT NULL)     AS con_salario_declarado,
  (SELECT salario_minimo FROM roldanerp.rrhh_parametros LIMIT 1)               AS salario_minimo_cargado;
