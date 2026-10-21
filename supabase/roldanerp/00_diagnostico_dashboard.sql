-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 00 · Diagnóstico de "Sin vistas asignadas" en el Dashboard
-- ============================================================================
--
-- Solo LEE. No modifica nada. Correlo entero y mirá la columna `diagnostico`.
--
-- La app resuelve las pestañas así (resolve-effective-dashboard-views.ts):
--   1. Busca las vistas habilitadas en `empresa_dashboard_views`.
--   2. Si no hay ninguna, cae a "todas las activas de `dashboard_views`".
--   3. Si ahí tampoco hay ninguna, muestra "Sin vistas asignadas".
--
-- Un usuario con rol `admin` NO pasa por `usuario_dashboard_views`: le alcanza
-- con que la empresa tenga vistas. Así que si sos admin y ves el cartel, el
-- problema está en los pasos 1 y 2, no en tu perfil.
-- ============================================================================

SELECT
  'dashboard_views (catálogo)' AS tabla,
  count(*)                      AS filas,
  count(*) FILTER (WHERE activo IS TRUE) AS activas,
  CASE
    WHEN count(*) = 0
      THEN 'VACÍO → esta es la causa. Correr 04_catalogos.sql.'
    WHEN count(*) FILTER (WHERE activo IS TRUE) = 0
      THEN 'Hay filas pero ninguna activa → correr 04_catalogos.sql, que las reactiva.'
    ELSE 'OK'
  END AS diagnostico
FROM roldanerp.dashboard_views

UNION ALL

SELECT
  'empresa_dashboard_views',
  count(*),
  count(*) FILTER (WHERE activo IS TRUE),
  CASE
    WHEN count(*) = 0
      THEN 'Vacío. No es grave por sí solo: la app cae al catálogo completo.'
    WHEN count(*) FILTER (WHERE activo IS TRUE) = 0
      THEN 'Todas apagadas → correr 04_catalogos.sql.'
    ELSE 'OK'
  END
FROM roldanerp.empresa_dashboard_views

UNION ALL

SELECT
  'empresas',
  count(*),
  count(*),
  CASE WHEN count(*) <> 1
       THEN 'Debería haber exactamente 1 empresa. Revisar 02_seed.'
       ELSE 'OK' END
FROM roldanerp.empresas;

-- ---------------------------------------------------------------------------
-- El usuario con el que entrás: rol y empresa.
-- Si `rol` no es 'admin' ni 'super_admin', además mirá usuario_dashboard_views.
-- ---------------------------------------------------------------------------
SELECT id, email, rol, empresa_id, activo
FROM roldanerp.usuarios
WHERE email = 'admin@roldanehijos.com';

-- ---------------------------------------------------------------------------
-- Si el catálogo tiene filas pero el Dashboard sigue vacío, lo más probable es
-- que PostgREST esté sirviendo un esquema viejo. Esto lo recarga:
-- ---------------------------------------------------------------------------
-- NOTIFY pgrst, 'reload schema';
