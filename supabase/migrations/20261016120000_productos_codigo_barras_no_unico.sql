-- =============================================================================
-- Código de barras: pasa de ÚNICO a NO ÚNICO (solo advertencia en la app)
--
-- Motivo: el negocio puede tener productos distintos que comparten el mismo
-- código de barras (p. ej. presentaciones o productos fabricados que reutilizan
-- un código). La unicidad dejaba de ser una regla dura y pasa a ser una
-- ADVERTENCIA que el usuario puede confirmar desde el formulario.
--
-- Cambios (por cada schema con tabla `productos`):
--   - DROP de CUALQUIER índice ÚNICO cuya definición incluya `codigo_barras`.
--     Se hace por definición (no por nombre) porque distintos schemas tienen el
--     índice con nombres distintos: `uq_productos_codigo_barras` (nombre
--     explícito de migraciones viejas) o `productos_empresa_id_sucursal_id_
--     codigo_barras_idx` (nombre autogenerado por supabase db diff). El índice
--     ÚNICO de SKU NO se toca (su definición no menciona `codigo_barras`).
--   - CREATE de un índice NO único para mantener lookups rápidos por código.
--   - El índice trigram (idx_productos_codigo_barras_trgm) se mantiene intacto.
--
-- Reglas: idempotente. No toca datos existentes. Solo opera sobre los schemas
-- de esta familia de instancia (no sobre otros tenants).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  ix RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'productos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'roldanerp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[codbar no-unico] procesando schema: %', r.sch;

    -- Quitar la unicidad: drop de todo índice ÚNICO sobre codigo_barras,
    -- cualquiera sea su nombre. (El único de SKU no matchea.)
    FOR ix IN
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = r.sch
        AND tablename = 'productos'
        AND indexdef ILIKE '%UNIQUE%'
        AND indexdef ILIKE '%codigo_barras%'
    LOOP
      RAISE NOTICE '  drop indice unico: %.%', r.sch, ix.indexname;
      EXECUTE format('DROP INDEX IF EXISTS %I.%I', r.sch, ix.indexname);
    END LOOP;

    -- Índice NO único para lookups exactos por código de barras.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras
         ON %I.productos (empresa_id, codigo_barras)
         WHERE codigo_barras IS NOT NULL',
      r.sch
    );
  END LOOP;
END;
$$;
