-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 76 · Amonestaciones y observaciones del empleado
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   En la ficha del empleado, un lugar para las amonestaciones, las
--   observaciones "y esas cosas": lo que hoy queda en un cuaderno o en la
--   memoria del encargado.
--
-- ── QUÉ SE GUARDA ──────────────────────────────────────────────────────────
--   Una fila por hecho, con su tipo:
--     observacion        nota interna, no se le comunica al empleado
--     llamada_atencion   advertencia verbal, que queda registrada
--     amonestacion       amonestación escrita: se imprime y el empleado firma
--     suspension         suspensión sin goce de sueldo, con sus días
--     reconocimiento     lo bueno también: felicitaciones, premios
--
--   `firmada_at` dice si el empleado firmó la notificación. No se borran:
--   una amonestación mal cargada se ANULA (estado = 'anulada') con su
--   motivo, para que el historial no se pueda limpiar a escondidas.
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

CREATE TABLE IF NOT EXISTS roldanerp.empleado_novedades (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  empleado_id        uuid NOT NULL,
  tipo               text NOT NULL
                     CHECK (tipo IN ('observacion','llamada_atencion','amonestacion','suspension','reconocimiento')),
  fecha              date NOT NULL DEFAULT current_date,
  motivo             text NOT NULL,
  detalle            text,
  -- Solo para suspensiones.
  dias_suspension    integer CHECK (dias_suspension IS NULL OR dias_suspension BETWEEN 1 AND 30),
  suspension_desde   date,
  firmada_at         timestamptz,
  estado             text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulada')),
  motivo_anulacion   text,
  created_by         uuid,
  created_by_nombre  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.empleado_novedades IS
  'Amonestaciones, suspensiones, llamadas de atención, observaciones y '
  'reconocimientos de cada empleado. No se borran: se anulan.';

CREATE INDEX IF NOT EXISTS idx_empleado_novedades_empleado
  ON roldanerp.empleado_novedades (empresa_id, empleado_id, fecha DESC);

-- ── Privilegios y RLS, calcados de `empleados` ─────────────────────────────
-- Así la tabla nueva queda visible para la API igual que la ficha del
-- empleado, sin adivinar qué roles usa esta instalación.
DO $perms$
DECLARE
  r      record;
  v_rls  boolean;
  v_sql  text;
BEGIN
  FOR r IN
    SELECT DISTINCT a.grantee, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados'
  LOOP
    EXECUTE format('GRANT %s ON TABLE roldanerp.empleado_novedades TO %s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END);
  END LOOP;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados';
  IF NOT coalesce(v_rls, false) THEN
    RETURN;
  END IF;

  ALTER TABLE roldanerp.empleado_novedades ENABLE ROW LEVEL SECURITY;
  FOR r IN
    SELECT pol.polname,
           CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                           WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                           ELSE 'ALL' END AS cmd,
           pol.polpermissive,
           (SELECT string_agg(
                     CASE WHEN rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(rolname) END, ', ')
              FROM (SELECT (SELECT r2.rolname FROM pg_roles r2 WHERE r2.oid = x) AS rolname
                    FROM unnest(pol.polroles) AS x) q) AS roles,
           pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
    FROM pg_policy pol
    JOIN pg_class c      ON c.oid = pol.polrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados'
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policy p2
      JOIN pg_class c2 ON c2.oid = p2.polrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'roldanerp' AND c2.relname = 'empleado_novedades' AND p2.polname = r.polname
    ) THEN
      CONTINUE;
    END IF;
    v_sql := format('CREATE POLICY %I ON roldanerp.empleado_novedades AS %s FOR %s TO %s',
                    r.polname,
                    CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                    r.cmd, coalesce(r.roles, 'PUBLIC'));
    IF r.qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || r.qual || ')'; END IF;
    IF r.withcheck IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || r.withcheck || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END
$perms$;

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT tipo, count(*) AS cantidad
FROM roldanerp.empleado_novedades
GROUP BY tipo
UNION ALL
SELECT 'total', count(*) FROM roldanerp.empleado_novedades;
