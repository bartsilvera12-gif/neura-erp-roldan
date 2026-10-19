-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 04 · Catálogos globales que el clon dejó vacíos
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   `01_clone_schema...` copia la ESTRUCTURA de `mexicana` sin ninguna fila. Eso
--   es lo correcto para las tablas operativas, pero algunas tablas son CATÁLOGOS:
--   el ERP espera filas ahí desde el minuto cero y, vacías, la pantalla sale en
--   blanco. `modulos` ya lo cubre el script 02; acá van los que faltaban.
--
--   Síntoma que resuelve: el Dashboard mostraba "Sin vistas asignadas" aunque el
--   usuario fuera admin. `resolve-effective-dashboard-views.ts` cae a "todas las
--   vistas activas del catálogo" cuando `empresa_dashboard_views` está vacío —
--   pero si `dashboard_views` también está vacío, ese fallback devuelve cero.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero el script 01.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roldanerp.empresas) THEN
    RAISE EXCEPTION 'No hay empresa en `roldanerp`. Correr primero el script 02.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Vistas del tablero (pestañas del Dashboard)
--    Catálogo global + habilitación para la empresa. Los slugs son los cuatro
--    que entiende la app (`isDashboardTabSlug`): cualquier otro se ignora.
-- ---------------------------------------------------------------------------
DO $views$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'dashboard_views' AND c.relkind = 'r'
  ) THEN
    RAISE NOTICE 'No hay tabla `dashboard_views` en el schema; se omite.';
    RETURN;
  END IF;

  INSERT INTO roldanerp.dashboard_views (slug, nombre, orden, activo)
  VALUES
    ('comercial',  'Comercial',  10, true),
    ('financiero', 'Financiero', 20, true),
    ('inventario', 'Inventario', 30, true),
    ('ventas',     'Ventas',     40, true)
  ON CONFLICT (slug) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    orden  = EXCLUDED.orden,
    activo = EXCLUDED.activo;

  -- Habilitación para la empresa (todas las vistas activas).
  INSERT INTO roldanerp.empresa_dashboard_views (empresa_id, dashboard_view_id, activo)
  SELECT e.id, dv.id, true
  FROM roldanerp.empresas e
  CROSS JOIN roldanerp.dashboard_views dv
  WHERE dv.activo IS TRUE
  ON CONFLICT (empresa_id, dashboard_view_id) DO UPDATE SET activo = true;

  SELECT count(*) INTO v_n
  FROM roldanerp.empresa_dashboard_views WHERE activo;
  RAISE NOTICE 'Vistas de dashboard habilitadas para la empresa: %', v_n;
END
$views$;

-- ---------------------------------------------------------------------------
-- 2) Etapas del CRM (columnas del funnel)
--    Sin estas filas el tablero de CRM no tiene dónde apoyar las oportunidades.
-- ---------------------------------------------------------------------------
DO $crm$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'crm_etapas' AND c.relkind = 'r'
  ) THEN
    RAISE NOTICE 'No hay tabla `crm_etapas` en el schema; se omite.';
    RETURN;
  END IF;

  INSERT INTO roldanerp.crm_etapas (empresa_id, codigo, nombre, color, orden, activo)
  SELECT e.id, v.codigo, v.nombre, v.color, v.orden, true
  FROM roldanerp.empresas e
  CROSS JOIN (VALUES
    ('LEAD',        'Lead',        'gray',  1),
    ('CONTACTADO',  'Contactado',  'blue',  2),
    ('NEGOCIACION', 'Negociación', 'amber', 3),
    ('GANADO',      'Ganado',      'green', 4),
    ('PERDIDO',     'Perdido',     'red',   5)
  ) AS v(codigo, nombre, color, orden)
  ON CONFLICT (empresa_id, codigo) DO NOTHING;

  SELECT count(*) INTO v_n FROM roldanerp.crm_etapas WHERE activo;
  RAISE NOTICE 'Etapas de CRM activas: %', v_n;
END
$crm$;

-- ---------------------------------------------------------------------------
-- 3) Chequeo: ninguna tabla de catálogo conocida queda vacía
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  r      record;
  v_n    bigint;
  v_bad  text := '';
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['modulos', 'empresa_modulos', 'dashboard_views',
                        'empresa_dashboard_views', 'crm_etapas']) AS t
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'roldanerp' AND c.relname = r.t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('SELECT count(*) FROM roldanerp.%I', r.t) INTO v_n;
      RAISE NOTICE '  % -> % filas', rpad(r.t, 26), v_n;
      IF v_n = 0 THEN
        v_bad := v_bad || ' ' || r.t;
      END IF;
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Quedaron catálogos vacíos:%. Revisar antes de usar el ERP.', v_bad;
  END IF;
END
$check$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Recargar el cache de esquema de PostgREST.
-- Sin esto, la API sigue sirviendo el esquema que tenía al arrancar y los catálogos
-- no existen para la app aunque sí estén en la base ("Could not find the table
-- ... in the schema cache"). Es la causa típica de "corrí el SQL y no anda".
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

