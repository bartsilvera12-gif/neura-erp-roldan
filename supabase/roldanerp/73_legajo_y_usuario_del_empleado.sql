-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 73 · Legajo del empleado y su usuario del sistema
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Legajo, que es el código del empleado, no tiene agregado, y no está
--   mezclada la parte de usuario con RRHH: quiero poner qué empleado
--   corresponde a qué usuario."
--
-- ── QUÉ AGREGA ─────────────────────────────────────────────────────────────
--   empleados.legajo      El código del empleado. Texto, no número: hay casas
--                         que usan "A-012" o el legajo del sistema anterior.
--                         Único por empresa.
--   empleados.usuario_id  El usuario del sistema que es esta persona. Un
--                         usuario es a lo sumo UN empleado (único por empresa);
--                         un empleado puede no tener usuario (el que no usa el
--                         sistema).
--
--   Sin FOREIGN KEY a usuarios a propósito: la tabla vino clonada y no hay
--   garantía de que `usuarios.id` sea clave en este esquema. La pantalla solo
--   ofrece usuarios existentes de la empresa.
--
-- ── LO QUE TOCA DE LOS DATOS ───────────────────────────────────────────────
--   1. A los empleados sin legajo les numera uno: 0001, 0002… por fecha de
--      ingreso, siguiendo después del legajo numérico más alto que ya exista.
--      A los que ya tienen legajo no los toca.
--   2. Vincula empleado y usuario SOLO cuando el correo coincide sin dudas:
--      un único usuario y un único empleado con ese correo en la empresa, y
--      ese usuario todavía sin empleado. El resto se vincula a mano desde la
--      ficha del empleado.
--
-- Idempotente: se puede correr dos veces. La segunda no cambia nada.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.empleados') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.empleados.';
  END IF;
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.usuarios.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.empleados ADD COLUMN IF NOT EXISTS legajo text;
ALTER TABLE roldanerp.empleados ADD COLUMN IF NOT EXISTS usuario_id uuid;

COMMENT ON COLUMN roldanerp.empleados.legajo IS
  'Código del empleado (legajo). Único por empresa.';
COMMENT ON COLUMN roldanerp.empleados.usuario_id IS
  'Usuario del sistema que corresponde a este empleado (roldanerp.usuarios.id). '
  'Un usuario es a lo sumo un empleado.';

-- Un legajo con espacios alrededor es el mismo legajo.
UPDATE roldanerp.empleados
   SET legajo = NULLIF(btrim(legajo), '')
 WHERE legajo IS DISTINCT FROM NULLIF(btrim(legajo), '');

-- ── 1. Numerar a los que no tienen legajo ──────────────────────────────────
WITH base AS (
  SELECT empresa_id,
         COALESCE(MAX(legajo::bigint) FILTER (WHERE legajo ~ '^[0-9]{1,15}$'), 0) AS maxn
    FROM roldanerp.empleados
   GROUP BY empresa_id
),
sin AS (
  SELECT id, empresa_id,
         row_number() OVER (PARTITION BY empresa_id ORDER BY fecha_ingreso NULLS LAST, nombre, id) AS rn
    FROM roldanerp.empleados
   WHERE legajo IS NULL
)
UPDATE roldanerp.empleados e
   SET legajo = lpad((b.maxn + s.rn)::text, 4, '0')
  FROM sin s
  JOIN base b ON b.empresa_id = s.empresa_id
 WHERE e.id = s.id;

-- Después de numerar, para que el índice no choque con los NULL de antes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_legajo
  ON roldanerp.empleados (empresa_id, legajo)
  WHERE legajo IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_usuario
  ON roldanerp.empleados (empresa_id, usuario_id)
  WHERE usuario_id IS NOT NULL;

-- ── 2. Vincular por correo, solo lo indiscutible ───────────────────────────
WITH emp AS (
  SELECT id, empresa_id, lower(btrim(email)) AS mail
    FROM roldanerp.empleados
   WHERE usuario_id IS NULL AND NULLIF(btrim(email), '') IS NOT NULL
),
emp_unico AS (
  SELECT e.* FROM emp e
   WHERE (SELECT count(*) FROM roldanerp.empleados x
           WHERE x.empresa_id = e.empresa_id AND lower(btrim(x.email)) = e.mail) = 1
),
usr AS (
  SELECT u.id, u.empresa_id, lower(btrim(u.email)) AS mail
    FROM roldanerp.usuarios u
   WHERE NULLIF(btrim(u.email), '') IS NOT NULL
),
usr_unico AS (
  SELECT u.* FROM usr u
   WHERE (SELECT count(*) FROM usr y WHERE y.empresa_id = u.empresa_id AND y.mail = u.mail) = 1
     AND NOT EXISTS (SELECT 1 FROM roldanerp.empleados z WHERE z.usuario_id = u.id)
)
UPDATE roldanerp.empleados e
   SET usuario_id = u.id
  FROM emp_unico x
  JOIN usr_unico u ON u.empresa_id = x.empresa_id AND u.mail = x.mail
 WHERE e.id = x.id;

-- PostgREST tiene que enterarse de las columnas nuevas.
NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.empleados)                              AS empleados,
  (SELECT count(*) FROM roldanerp.empleados WHERE legajo IS NOT NULL)     AS con_legajo,
  (SELECT count(*) FROM roldanerp.empleados WHERE usuario_id IS NOT NULL) AS con_usuario,
  (SELECT count(*) FROM roldanerp.usuarios)                               AS usuarios,
  (SELECT string_agg(legajo || ' · ' || nombre, ', ' ORDER BY legajo)
     FROM roldanerp.empleados)                                            AS legajos;
