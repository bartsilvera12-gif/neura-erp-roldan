-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 03 · Verificación: aislamiento del schema `roldanerp` y semilla correcta
-- ============================================================================
-- Solo LEE. Pegalo en el SQL editor después de 01 y 02.
-- ============================================================================

-- 1) Schemas de la base. `roldanerp` tiene que aparecer y el resto quedar como estaba.
SELECT nspname AS schema
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%'
   AND nspname <> 'information_schema'
 ORDER BY 1;

-- 2) Conteos estructurales: `roldanerp` vs `mexicana`. Deben coincidir.
SELECT objeto,
       mexicana,
       roldanerp,
       CASE WHEN mexicana = roldanerp THEN 'OK' ELSE 'REVISAR' END AS estado
FROM (
  SELECT 'tablas' AS objeto,
         count(*) FILTER (WHERE n.nspname = 'mexicana')  AS mexicana,
         count(*) FILTER (WHERE n.nspname = 'roldanerp') AS roldanerp
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p') AND n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'vistas',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('v','m') AND n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'secuencias',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'S' AND n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'funciones',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'indices',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'constraints',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'politicas_rls',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'triggers',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname IN ('mexicana','roldanerp')
  UNION ALL
  SELECT 'tipos',
         count(*) FILTER (WHERE n.nspname = 'mexicana'),
         count(*) FILTER (WHERE n.nspname = 'roldanerp')
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('e','d','c')
     AND NOT EXISTS (SELECT 1 FROM pg_class rc WHERE rc.oid = t.typrelid AND rc.relkind <> 'c')
     AND n.nspname IN ('mexicana','roldanerp')
) q
ORDER BY objeto;

-- 3) Independencia: NINGUNA referencia de `roldanerp` debe apuntar a `mexicana`.
--    `auth` sí es esperable (usuarios.auth_user_id → auth.users).
SELECT 'fk_cruzada' AS tipo,
       c.relname    AS tabla,
       k.conname    AS constraint_name,
       fn.nspname   AS schema_referenciado,
       fc.relname   AS tabla_referenciada
  FROM pg_constraint k
  JOIN pg_class c       ON c.oid  = k.conrelid
  JOIN pg_namespace n   ON n.oid  = c.relnamespace
  JOIN pg_class fc      ON fc.oid = k.confrelid
  JOIN pg_namespace fn  ON fn.oid = fc.relnamespace
 WHERE n.nspname = 'roldanerp'
   AND k.contype = 'f'
   AND fn.nspname <> 'roldanerp'
 ORDER BY 2, 3;
-- Esperado: solo filas con schema_referenciado = 'auth'. Ninguna con 'mexicana'.

-- 4) Independencia: ninguna columna de `roldanerp` usa un tipo de `mexicana`.
SELECT c.relname AS tabla, a.attname AS columna,
       format_type(a.atttypid, a.atttypmod) AS tipo
  FROM pg_attribute a
  JOIN pg_class c      ON c.oid = a.attrelid
  JOIN pg_namespace n  ON n.oid = c.relnamespace
  JOIN pg_type t       ON t.oid = a.atttypid
  JOIN pg_namespace tn ON tn.oid = t.typnamespace
 WHERE n.nspname = 'roldanerp'
   AND a.attnum > 0 AND NOT a.attisdropped
   AND tn.nspname = 'mexicana'
 ORDER BY 1, 2;
-- Esperado: 0 filas.

-- 5) Independencia: ninguna función / vista / política de `roldanerp` menciona `mexicana`.
-- Los filtros van sobre el catálogo directo (`pronamespace`/`relnamespace`) para que
-- el planner no evalúe `pg_get_functiondef` sobre funciones de otros schemas.
SELECT 'funcion' AS objeto, nombre, def ~ '\mmexicana\M' AS menciona
  FROM (
    SELECT p.proname AS nombre, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
     WHERE p.pronamespace = 'roldanerp'::regnamespace
       AND p.prokind IN ('f','p','w')
  ) f
 WHERE def ~ '\mmexicana\M'
UNION ALL
SELECT 'vista', nombre, true
  FROM (
    SELECT c.relname AS nombre, pg_get_viewdef(c.oid, true) AS def
      FROM pg_class c
     WHERE c.relnamespace = 'roldanerp'::regnamespace
       AND c.relkind IN ('v','m')
  ) v
 WHERE def ~ '\mmexicana\M'
UNION ALL
SELECT 'politica', pol.polname, true
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
 WHERE c.relnamespace = 'roldanerp'::regnamespace
   AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ~ '\mmexicana\M'
     OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ '\mmexicana\M')
ORDER BY 1, 2;
-- Esperado: 0 filas.

-- 6) Tablas con datos. Solo deben tener filas las de la semilla.
SELECT relname AS tabla, filas
  FROM (
    SELECT c.relname,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM roldanerp.%I', c.relname),
                               false, true, '')))[1]::text::bigint AS filas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'roldanerp' AND c.relkind = 'r'
  ) q
 WHERE filas > 0
 ORDER BY 1;
-- Esperado: solo empresas (1), modulos (12+), empresa_modulos (12),
-- usuarios (1), usuario_modulos (12) y sucursales / usuario_sucursales (1).

-- 7) Semilla: empresa, usuario y módulos habilitados.
SELECT id, nombre_empresa, data_schema FROM roldanerp.empresas;

SELECT email, rol, estado,
       auth_user_id IS NOT NULL AS enlazado_a_auth
  FROM roldanerp.usuarios
 ORDER BY email;

SELECT m.slug, m.nombre, em.activo
  FROM roldanerp.empresa_modulos em
  JOIN roldanerp.modulos m ON m.id = em.modulo_id
 WHERE em.activo
 ORDER BY m.slug;
-- Esperado: exactamente clientes, compras, contabilidad, conversaciones, crm,
-- dashboard, inventario, pagos, proveedores, rrhh, sucursales, ventas (12).

-- 8) Privilegios del schema: tienen que ser los mismos que en `mexicana`.
--    (Exponerlo en la API es aparte: Settings → API → Exposed schemas.)
SELECT coalesce(r.rolname, 'PUBLIC') AS rol,
       string_agg(DISTINCT a.privilege_type, ', ') FILTER (WHERE a.schema = 'mexicana')  AS en_mexicana,
       string_agg(DISTINCT a.privilege_type, ', ') FILTER (WHERE a.schema = 'roldanerp') AS en_roldanerp
  FROM (
    SELECT n.nspname AS schema, x.grantee, x.privilege_type
      FROM pg_namespace n, aclexplode(n.nspacl) x
     WHERE n.nspname IN ('mexicana', 'roldanerp')
  ) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
 GROUP BY 1
 ORDER BY 1;
-- Esperado: las dos columnas iguales para cada rol (anon, authenticated, service_role...).
