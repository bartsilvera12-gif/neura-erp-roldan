-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 01 · Clon ESTRUCTURAL del schema `mexicana` → `roldanerp` (SIN DATOS)
-- ============================================================================
--
-- Qué hace
--   Crea el schema `roldanerp` y copia desde `mexicana`:
--     tipos (enum / dominio / compuesto), secuencias, tablas (incl. particionadas),
--     columnas, defaults, identidades, constraints (PK / UNIQUE / CHECK / EXCLUDE / FK),
--     índices, vistas, vistas materializadas, funciones y procedimientos, triggers,
--     Row Level Security + políticas, privilegios (GRANT) y comentarios.
--   NO copia ni una fila: todas las tablas quedan vacías y las secuencias en su START.
--
-- Qué NO toca
--   Ningún otro schema. No escribe en `public`, `auth`, `storage`, `zentra_erp`
--   ni en `mexicana` (de ahí solo LEE el catálogo). Si `roldanerp` ya existe, aborta.
--
-- Cómo usarlo
--   Pegar completo en Supabase → SQL Editor → Run. Corre en una sola transacción:
--   si algo falla no queda nada a medias.
--   Ejecutarlo con un rol superusuario / `postgres`: los objetos quedan con ese owner,
--   igual que en `mexicana`.
--
-- Después
--   1) Settings → API → Exposed schemas: agregar `roldanerp`.
--   2) Correr `02_seed_empresa_modulos_admin.sql`.
--   3) Correr `03_verificacion.sql`.
--
-- Diferencias conocidas respecto de un `pg_dump` de `mexicana`
--   * El COMMENT del schema es el de esta instancia, no el del origen (a propósito).
--   * `empresas.data_schema`: el DEFAULT pasa a 'roldanerp'. Es el nombre del schema
--     del tenant, que la app lee; no es un dato de negocio. Ver el paso 13.b.
--   * Los CHECK marcados NOT VALID en `mexicana` quedan validados en el clon.
--     Con las tablas vacías es equivalente y algo más estricto.
--   * En tablas con HERENCIA CLÁSICA (no particiones), las columnas heredadas quedan
--     con `attislocal = true`. Solo cambia qué pasa si algún día se desconecta la
--     tabla hija del padre; el comportamiento normal es idéntico.
--   * Las vistas materializadas se crean WITH NO DATA: hay que refrescarlas cuando
--     haya datos (`REFRESH MATERIALIZED VIEW roldanerp.<vista>`).
--   * La publicación de Realtime es global de la base, no del schema: si el ERP usa
--     Realtime, agregar a mano las tablas de `roldanerp` a la publicación
--     `supabase_realtime` (en `mexicana` son `chat_messages` y `chat_conversations`).
-- ============================================================================

BEGIN;

SET LOCAL check_function_bodies = off;
SET LOCAL client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'mexicana') THEN
    RAISE EXCEPTION 'No existe el schema origen `mexicana` en esta base.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'El schema `roldanerp` ya existe. Borralo a mano (DROP SCHEMA roldanerp CASCADE) si querés reclonarlo.';
  END IF;
END
$guard$;

CREATE SCHEMA roldanerp;

COMMENT ON SCHEMA roldanerp IS
  'Neura ERP · Roldán e Hijos. Clon estructural de `mexicana` sin datos. Instancia dedicada monocliente.';

-- Owner del schema igual al de `mexicana` (si el rol actual puede asignarlo).
DO $owner$
DECLARE v_owner name;
BEGIN
  SELECT pg_get_userbyid(nspowner) INTO v_owner FROM pg_namespace WHERE nspname = 'mexicana';
  BEGIN
    EXECUTE format('ALTER SCHEMA roldanerp OWNER TO %I', v_owner);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudo asignar el owner %; el schema queda con el rol actual.', v_owner;
  END;
END
$owner$;

-- ---------------------------------------------------------------------------
-- Helper de reescritura: `mexicana` → `roldanerp` dentro de definiciones SQL.
-- Vive en el propio schema clonado y se elimina al final del script.
-- ---------------------------------------------------------------------------
CREATE FUNCTION roldanerp.__clone_rewrite(def text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s     text := def;
  prev  text;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) Referencias calificadas: `mexicana.tabla` → `roldanerp.tabla`.
  --    Solo con punto, para no pisar literales de texto que contengan la palabra.
  s := regexp_replace(s, '\mmexicana\.', 'roldanerp.', 'g');
  s := regexp_replace(s, '"mexicana"\.', 'roldanerp.', 'g');

  -- 2) `SET search_path = mexicana, public` (sin calificar) dentro de funciones.
  --    Se reemplaza item por item hasta que no quede ninguno en esa cláusula.
  LOOP
    prev := s;
    s := regexp_replace(
           s,
           '(search_path[^;\n]*?)\mmexicana\M',
           '\1roldanerp',
           'gi'
         );
    EXIT WHEN s = prev;
  END LOOP;

  -- 3) `search_path` con el schema entre comillas simples.
  LOOP
    prev := s;
    s := regexp_replace(s, '(search_path[^;\n]*?)''mexicana''', '\1''roldanerp''', 'gi');
    EXIT WHEN s = prev;
  END LOOP;

  RETURN s;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 1) Tipos: enums, dominios y tipos compuestos
-- ---------------------------------------------------------------------------
DO $types$
DECLARE
  r      record;
  v_sql  text;
  v_cols text;
BEGIN
  -- 1.a ENUMs
  FOR r IN
    SELECT t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e      ON e.enumtypid = t.oid
    WHERE n.nspname = 'mexicana' AND t.typtype = 'e'
    GROUP BY t.typname
    ORDER BY t.typname
  LOOP
    EXECUTE format('CREATE TYPE roldanerp.%I AS ENUM (%s)', r.typname, r.labels);
  END LOOP;

  -- 1.b DOMINIOS
  FOR r IN
    SELECT t.typname,
           format_type(t.typbasetype, t.typtypmod) AS basetype,
           t.typnotnull,
           t.typdefault,
           t.oid
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'mexicana' AND t.typtype = 'd'
    ORDER BY t.typname
  LOOP
    v_sql := format('CREATE DOMAIN roldanerp.%I AS %s',
                    r.typname,
                    roldanerp.__clone_rewrite(r.basetype));
    IF r.typdefault IS NOT NULL THEN
      v_sql := v_sql || ' DEFAULT ' || roldanerp.__clone_rewrite(r.typdefault);
    END IF;
    IF r.typnotnull THEN
      v_sql := v_sql || ' NOT NULL';
    END IF;
    FOR v_cols IN
      SELECT roldanerp.__clone_rewrite(pg_get_constraintdef(c.oid))
      FROM pg_constraint c
      WHERE c.contypid = r.oid
      ORDER BY c.conname
    LOOP
      v_sql := v_sql || ' ' || v_cols;
    END LOOP;
    EXECUTE v_sql;
  END LOOP;

  -- 1.c TIPOS COMPUESTOS (los row types de tablas/vistas quedan fuera)
  FOR r IN
    SELECT t.typname, c.oid AS reloid
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_class c     ON c.oid = t.typrelid
    WHERE n.nspname = 'mexicana' AND t.typtype = 'c' AND c.relkind = 'c'
    ORDER BY t.typname
  LOOP
    SELECT string_agg(
             format('%I %s', a.attname,
                    roldanerp.__clone_rewrite(format_type(a.atttypid, a.atttypmod))),
             ', ' ORDER BY a.attnum)
      INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = r.reloid AND a.attnum > 0 AND NOT a.attisdropped;

    IF v_cols IS NOT NULL THEN
      EXECUTE format('CREATE TYPE roldanerp.%I AS (%s)', r.typname, v_cols);
    END IF;
  END LOOP;
END
$types$;

-- ---------------------------------------------------------------------------
-- 2) Funciones y procedimientos — primera pasada (best effort)
--    Se crean antes de las tablas porque los DEFAULT de columnas pueden invocarlas.
--    Las que dependen de tablas (parámetros/retornos con rowtype) se reintentan
--    después, en la pasada estricta.
-- ---------------------------------------------------------------------------
DO $funcs1$
DECLARE
  r       record;
  v_prev  int := -1;
  v_left  int;
  v_pass  int := 0;
BEGIN
  CREATE TEMP TABLE _clone_funcs ON COMMIT DROP AS
  -- El filtro va sobre `pronamespace` (no por join con pg_namespace) para que el
  -- planner no llame a `pg_get_functiondef` sobre funciones de otros schemas:
  -- sobre un agregado esa función levanta error.
  SELECT oid, proname, roldanerp.__clone_rewrite(pg_get_functiondef(oid)) AS def
  FROM (
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'mexicana'::regnamespace
      AND p.prokind IN ('f', 'p', 'w')
  ) q;

  LOOP
    v_pass := v_pass + 1;
    SELECT count(*) INTO v_left FROM _clone_funcs;
    EXIT WHEN v_left = 0 OR v_left = v_prev OR v_pass > 12;
    v_prev := v_left;

    FOR r IN SELECT * FROM _clone_funcs LOOP
      BEGIN
        EXECUTE r.def;
        DELETE FROM _clone_funcs WHERE oid = r.oid;
      EXCEPTION WHEN others THEN
        NULL;  -- se reintenta en la pasada estricta
      END;
    END LOOP;
  END LOOP;
END
$funcs1$;

-- ---------------------------------------------------------------------------
-- 3) Tablas (incluye particionadas) con columnas, defaults, identidad,
--    PK / UNIQUE / CHECK / EXCLUDE, índices, storage y comentarios.
--    Las FOREIGN KEY se agregan después, cuando ya existen todas las tablas.
-- ---------------------------------------------------------------------------
DO $tables$
DECLARE
  r           record;
  v_level     int;
  v_created   int;
  v_newtype   text;
BEGIN
  -- 2.a Tablas raíz: ordinarias y padres de partición (sin herencia/partición por encima).
  FOR r IN
    SELECT c.relname, c.relkind, c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
    ORDER BY c.relname
  LOOP
    IF r.relkind = 'p' THEN
      EXECUTE format(
        'CREATE TABLE roldanerp.%I (LIKE mexicana.%I INCLUDING ALL EXCLUDING INDEXES EXCLUDING CONSTRAINTS) PARTITION BY %s',
        r.relname, r.relname, pg_get_partkeydef(r.oid));
    ELSE
      EXECUTE format('CREATE TABLE roldanerp.%I (LIKE mexicana.%I INCLUDING ALL EXCLUDING INDEXES EXCLUDING CONSTRAINTS)',
                     r.relname, r.relname);
    END IF;
  END LOOP;

  -- 2.b Hijas: particiones y tablas heredadas, nivel por nivel.
  FOR v_level IN 1..10 LOOP
    v_created := 0;

    FOR r IN
      SELECT c.relname,
             c.relkind,
             c.oid,
             p.relname AS parent_name,
             c.relispartition,
             pg_get_expr(c.relpartbound, c.oid) AS partbound,
             pg_get_partkeydef(c.oid)           AS partkey
      FROM pg_class c
      JOIN pg_namespace n  ON n.oid = c.relnamespace
      JOIN pg_inherits i   ON i.inhrelid = c.oid
      JOIN pg_class p      ON p.oid = i.inhparent
      JOIN pg_namespace pn ON pn.oid = p.relnamespace
      WHERE n.nspname = 'mexicana'
        AND pn.nspname = 'mexicana'
        AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_class dc
          JOIN pg_namespace dn ON dn.oid = dc.relnamespace
          WHERE dn.nspname = 'roldanerp' AND dc.relname = c.relname
        )
        AND EXISTS (
          SELECT 1 FROM pg_class dp
          JOIN pg_namespace dn2 ON dn2.oid = dp.relnamespace
          WHERE dn2.nspname = 'roldanerp' AND dp.relname = p.relname
        )
      ORDER BY c.relname
    LOOP
      IF r.relispartition THEN
        IF r.relkind = 'p' THEN
          EXECUTE format('CREATE TABLE roldanerp.%I PARTITION OF roldanerp.%I %s PARTITION BY %s',
                         r.relname, r.parent_name, r.partbound, r.partkey);
        ELSE
          EXECUTE format('CREATE TABLE roldanerp.%I PARTITION OF roldanerp.%I %s',
                         r.relname, r.parent_name, r.partbound);
        END IF;
      ELSE
        EXECUTE format('CREATE TABLE roldanerp.%I (LIKE mexicana.%I INCLUDING ALL EXCLUDING INDEXES EXCLUDING CONSTRAINTS) INHERITS (roldanerp.%I)',
                       r.relname, r.relname, r.parent_name);
      END IF;
      v_created := v_created + 1;
    END LOOP;

    EXIT WHEN v_created = 0;
  END LOOP;

  -- 2.c Columnas cuyo tipo vive en el schema origen.
  --     `LIKE` copia la columna apuntando al tipo de `mexicana` (enum, dominio,
  --     compuesto o array de ellos). Se repasan al tipo clonado para que el schema
  --     no dependa del origen. Las tablas están vacías: el cambio de tipo no mueve datos.
  --     Se omiten las columnas heredadas (attinhcount > 0): se cambian en la tabla padre
  --     y Postgres propaga a las hijas.
  FOR r IN
    SELECT c.relname,
           a.attname,
           format_type(a.atttypid, a.atttypmod) AS oldtype,
           pg_get_expr(ad.adbin, ad.adrelid)    AS def,
           a.attnotnull
    FROM pg_attribute a
    JOIN pg_class c       ON c.oid = a.attrelid
    JOIN pg_namespace n   ON n.oid = c.relnamespace
    JOIN pg_type t        ON t.oid = a.atttypid
    JOIN pg_namespace tn  ON tn.oid = t.typnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'roldanerp'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attinhcount = 0
      AND (
        tn.nspname = 'mexicana'
        OR (t.typelem <> 0 AND EXISTS (
              SELECT 1 FROM pg_type et
              JOIN pg_namespace etn ON etn.oid = et.typnamespace
              WHERE et.oid = t.typelem AND etn.nspname = 'mexicana'))
      )
    ORDER BY c.relname, a.attnum
  LOOP
    v_newtype := regexp_replace(r.oldtype, '\mmexicana\.', 'roldanerp.', 'g');
    v_newtype := regexp_replace(v_newtype, '"mexicana"\.', 'roldanerp.', 'g');

    IF r.def IS NOT NULL THEN
      EXECUTE format('ALTER TABLE roldanerp.%I ALTER COLUMN %I DROP DEFAULT', r.relname, r.attname);
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE roldanerp.%I ALTER COLUMN %I TYPE %s',
                     r.relname, r.attname, v_newtype);
    EXCEPTION WHEN others THEN
      -- Sin cast implícito (enum ↔ enum, dominio ↔ dominio): pasar por texto.
      EXECUTE format('ALTER TABLE roldanerp.%I ALTER COLUMN %I TYPE %s USING %I::text::%s',
                     r.relname, r.attname, v_newtype, r.attname, v_newtype);
    END;

  END LOOP;

  -- 2.d Chequeo: ninguna tabla quedó sin clonar.
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_class dc
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        WHERE dn.nspname = 'roldanerp' AND dc.relname = c.relname
      )
  LOOP
    RAISE EXCEPTION 'La tabla mexicana.% no se pudo clonar (jerarquía de herencia inesperada).', r.relname;
  END LOOP;
END
$tables$;

-- ---------------------------------------------------------------------------
-- 5) Secuencias sueltas (las de identidad ya las creó LIKE INCLUDING IDENTITY)
-- ---------------------------------------------------------------------------
DO $seqs$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname,
           s.seqtypid::regtype::text AS seqtype,
           s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_sequence s  ON s.seqrelid = c.oid
    WHERE n.nspname = 'mexicana'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_class dc
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        WHERE dn.nspname = 'roldanerp' AND dc.relname = c.relname
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE SEQUENCE roldanerp.%I AS %s INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s %s',
      r.relname, r.seqtype, r.seqincrement, r.seqmin, r.seqmax, r.seqstart, r.seqcache,
      CASE WHEN r.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END);
  END LOOP;
END
$seqs$;

-- ---------------------------------------------------------------------------
-- 6) Funciones y procedimientos — pasada estricta
--    Reintenta lo que quedó de la pasada 1 (ya existen tablas, tipos y secuencias).
-- ---------------------------------------------------------------------------
DO $funcs2$
DECLARE
  r       record;
  v_prev  int := -1;
  v_left  int;
  v_pass  int := 0;
  v_fail  text;
BEGIN
  LOOP
    v_pass := v_pass + 1;
    SELECT count(*) INTO v_left FROM _clone_funcs;
    EXIT WHEN v_left = 0 OR v_left = v_prev OR v_pass > 12;
    v_prev := v_left;

    FOR r IN SELECT * FROM _clone_funcs LOOP
      BEGIN
        EXECUTE r.def;
        DELETE FROM _clone_funcs WHERE oid = r.oid;
      EXCEPTION WHEN others THEN
        v_fail := SQLERRM;
      END;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_left FROM _clone_funcs;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'No se pudieron crear % funciones (última falla: %). Revisar dependencias fuera de `mexicana`.',
      v_left, coalesce(v_fail, 'desconocida');
  END IF;
END
$funcs2$;

-- ---------------------------------------------------------------------------
-- 7) DEFAULT de cada columna, tomados del origen y reescritos al schema clonado
--    (cubre serial/nextval, casts a tipos propios y llamadas a funciones propias).
--    Las columnas IDENTITY no tienen DEFAULT: las creó `LIKE INCLUDING IDENTITY`.
-- ---------------------------------------------------------------------------
DO $defaults$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attrdef d
    JOIN pg_class c      ON c.oid = d.adrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_attribute a  ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p')
      AND a.attinhcount = 0
      AND NOT a.attgenerated = 's'   -- las generadas llevan su expresión, no un DEFAULT
      AND EXISTS (
        SELECT 1 FROM pg_class dc
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        WHERE dn.nspname = 'roldanerp' AND dc.relname = c.relname
      )
    ORDER BY c.relname, a.attnum
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.%I ALTER COLUMN %I SET DEFAULT %s',
                   r.relname, r.attname, roldanerp.__clone_rewrite(r.def));
  END LOOP;

  -- Propiedad de las secuencias (serial): la secuencia clonada pasa a pertenecer
  -- a la columna clonada, no a la de `mexicana`.
  FOR r IN
    SELECT sc.relname AS seqname, tc.relname AS tabname, a.attname
    FROM pg_depend dep
    JOIN pg_class sc      ON sc.oid = dep.objid AND sc.relkind = 'S'
    JOIN pg_namespace sn  ON sn.oid = sc.relnamespace
    JOIN pg_class tc      ON tc.oid = dep.refobjid
    JOIN pg_namespace tn  ON tn.oid = tc.relnamespace
    JOIN pg_attribute a   ON a.attrelid = tc.oid AND a.attnum = dep.refobjsubid
    WHERE sn.nspname = 'mexicana'
      AND tn.nspname = 'mexicana'
      AND dep.deptype = 'a'
      AND dep.classid = 'pg_class'::regclass
      AND dep.refclassid = 'pg_class'::regclass
      AND EXISTS (
        SELECT 1 FROM pg_class ds
        JOIN pg_namespace dsn ON dsn.oid = ds.relnamespace
        WHERE dsn.nspname = 'roldanerp' AND ds.relname = sc.relname
      )
      AND EXISTS (
        SELECT 1 FROM pg_class dt
        JOIN pg_namespace dtn ON dtn.oid = dt.relnamespace
        WHERE dtn.nspname = 'roldanerp' AND dt.relname = tc.relname
      )
  LOOP
    EXECUTE format('ALTER SEQUENCE roldanerp.%I OWNED BY roldanerp.%I.%I',
                   r.seqname, r.tabname, r.attname);
  END LOOP;
END
$defaults$;


-- Agregados definidos en el schema (si hubiera alguno).
DO $aggs$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           a.aggtransfn::regproc::text  AS sfunc,
           format_type(a.aggtranstype, NULL) AS stype,
           a.agginitval,
           a.aggfinalfn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_aggregate a ON a.aggfnoid = p.oid
    WHERE n.nspname = 'mexicana'
  LOOP
    EXECUTE format(
      'CREATE AGGREGATE roldanerp.%I(%s) (SFUNC = %s, STYPE = %s%s%s)',
      r.proname,
      roldanerp.__clone_rewrite(r.args),
      roldanerp.__clone_rewrite(r.sfunc),
      roldanerp.__clone_rewrite(r.stype),
      CASE WHEN r.aggfinalfn <> 0
           THEN ', FINALFUNC = ' || roldanerp.__clone_rewrite(r.aggfinalfn::regproc::text)
           ELSE '' END,
      CASE WHEN r.agginitval IS NOT NULL
           THEN ', INITCOND = ' || quote_literal(r.agginitval)
           ELSE '' END);
  END LOOP;
END
$aggs$;

-- ---------------------------------------------------------------------------
-- 8) Vistas y vistas materializadas (en orden de dependencias)
-- ---------------------------------------------------------------------------
DO $views$
DECLARE
  r       record;
  v_prev  int := -1;
  v_left  int;
  v_pass  int := 0;
  v_fail  text;
BEGIN
  CREATE TEMP TABLE _clone_views ON COMMIT DROP AS
  SELECT c.oid,
         c.relname,
         c.relkind,
         -- pg_get_viewdef cierra con `;`: se recorta para poder anexar WITH NO DATA.
         rtrim(rtrim(roldanerp.__clone_rewrite(pg_get_viewdef(c.oid, true))), ';') AS def
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'mexicana' AND c.relkind IN ('v', 'm');

  LOOP
    v_pass := v_pass + 1;
    SELECT count(*) INTO v_left FROM _clone_views;
    EXIT WHEN v_left = 0 OR v_left = v_prev OR v_pass > 20;
    v_prev := v_left;

    FOR r IN SELECT * FROM _clone_views ORDER BY relname LOOP
      BEGIN
        IF r.relkind = 'v' THEN
          EXECUTE format('CREATE VIEW roldanerp.%I AS %s', r.relname, r.def);
        ELSE
          -- WITH NO DATA: el clon no lleva datos.
          EXECUTE format('CREATE MATERIALIZED VIEW roldanerp.%I AS %s WITH NO DATA',
                         r.relname, r.def);
        END IF;
        DELETE FROM _clone_views WHERE oid = r.oid;
      EXCEPTION WHEN others THEN
        v_fail := SQLERRM;
      END;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_left FROM _clone_views;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'No se pudieron crear % vistas (última falla: %).', v_left, coalesce(v_fail, 'desconocida');
  END IF;
END
$views$;

-- Índices de las vistas materializadas (LIKE no aplica a matviews).
DO $matidx$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.indexrelid, ci.relname AS idxname,
           roldanerp.__clone_rewrite(pg_get_indexdef(i.indexrelid)) AS def
    FROM pg_index i
    JOIN pg_class c      ON c.oid = i.indrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_class ci     ON ci.oid = i.indexrelid
    WHERE n.nspname = 'mexicana' AND c.relkind = 'm'
  LOOP
    EXECUTE r.def;
  END LOOP;
END
$matidx$;

-- ---------------------------------------------------------------------------
-- 9) Constraints que LIKE no copia: FOREIGN KEY (y cualquier otra faltante)
-- ---------------------------------------------------------------------------
DO $fks$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname,
           t.relname AS tabname,
           roldanerp.__clone_rewrite(pg_get_constraintdef(c.oid)) AS def,
           c.convalidated
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    WHERE n.nspname = 'mexicana'
      AND c.contype IN ('f', 'c', 'u', 'p', 'x')
      AND t.relkind IN ('r', 'p')
      -- Las particiones y las tablas heredadas reciben el constraint del padre:
      -- agregarlo de nuevo falla con "already exists".
      AND c.conparentid = 0
      AND c.coninhcount = 0
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint dc
        JOIN pg_class dt      ON dt.oid = dc.conrelid
        JOIN pg_namespace dn  ON dn.oid = dt.relnamespace
        WHERE dn.nspname = 'roldanerp'
          AND dt.relname = t.relname
          AND dc.conname = c.conname
      )
    ORDER BY CASE c.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 WHEN 'x' THEN 4 ELSE 5 END,
             t.relname, c.conname
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.%I ADD CONSTRAINT %I %s%s',
                   r.tabname, r.conname, r.def,
                   CASE WHEN r.convalidated THEN '' ELSE ' NOT VALID' END);
  END LOOP;
END
$fks$;

-- ---------------------------------------------------------------------------
-- 9.b Índices que no respaldan un constraint (los de PK / UNIQUE / EXCLUDE los
--     creó el paso anterior). Se recrean desde `pg_get_indexdef` para conservar
--     el NOMBRE exacto del origen: hay migraciones y `ON CONFLICT` que lo usan.
--     Los índices de las particiones los propaga Postgres desde el padre.
-- ---------------------------------------------------------------------------
DO $idx$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT roldanerp.__clone_rewrite(pg_get_indexdef(i.indexrelid)) AS def,
           ci.relname AS idxname,
           c.relname  AS tabname
    FROM pg_index i
    JOIN pg_class c      ON c.oid = i.indrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_class ci     ON ci.oid = i.indexrelid
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p')
      -- sin constraint asociado (PK / UNIQUE / EXCLUDE ya vinieron como constraint)
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint pc WHERE pc.conindid = i.indexrelid
      )
      -- no heredado de una partición padre
      AND NOT EXISTS (
        SELECT 1 FROM pg_inherits ii WHERE ii.inhrelid = i.indexrelid
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class dci
        JOIN pg_namespace dn ON dn.oid = dci.relnamespace
        WHERE dn.nspname = 'roldanerp' AND dci.relname = ci.relname
      )
    ORDER BY c.relname, ci.relname
  LOOP
    EXECUTE r.def;
  END LOOP;
END
$idx$;

-- ---------------------------------------------------------------------------
-- 10) Triggers
-- ---------------------------------------------------------------------------
DO $trgs$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT roldanerp.__clone_rewrite(pg_get_triggerdef(tg.oid)) AS def,
           tg.tgenabled, tg.tgname, c.relname
    FROM pg_trigger tg
    JOIN pg_class c      ON c.oid = tg.tgrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND NOT tg.tgisinternal
      -- Los triggers de las particiones los clona Postgres desde el padre.
      AND tg.tgparentid = 0
    ORDER BY c.relname, tg.tgname
  LOOP
    EXECUTE r.def;
    IF r.tgenabled = 'D' THEN
      EXECUTE format('ALTER TABLE roldanerp.%I DISABLE TRIGGER %I', r.relname, r.tgname);
    END IF;
  END LOOP;
END
$trgs$;

-- Reglas (RULE) distintas de la regla interna de las vistas.
DO $rules$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT roldanerp.__clone_rewrite(pg_get_ruledef(ru.oid)) AS def
    FROM pg_rewrite ru
    JOIN pg_class c      ON c.oid = ru.ev_class
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND ru.rulename <> '_RETURN'
  LOOP
    EXECUTE r.def;
  END LOOP;
END
$rules$;

-- ---------------------------------------------------------------------------
-- 11) Row Level Security + políticas
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE
  r      record;
  v_sql  text;
BEGIN
  FOR r IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.%I ENABLE ROW LEVEL SECURITY', r.relname);
    IF r.relforcerowsecurity THEN
      EXECUTE format('ALTER TABLE roldanerp.%I FORCE ROW LEVEL SECURITY', r.relname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname,
           pol.polname,
           CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                           WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                           ELSE 'ALL' END AS cmd,
           pol.polpermissive,
           (SELECT string_agg(
                     CASE WHEN rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(rolname) END, ', ')
              FROM (
                SELECT (SELECT r2.rolname FROM pg_roles r2 WHERE r2.oid = x) AS rolname
                FROM unnest(pol.polroles) AS x
              ) q) AS roles,
           roldanerp.__clone_rewrite(pg_get_expr(pol.polqual, pol.polrelid))       AS qual,
           roldanerp.__clone_rewrite(pg_get_expr(pol.polwithcheck, pol.polrelid))  AS withcheck
    FROM pg_policy pol
    JOIN pg_class c      ON c.oid = pol.polrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
    ORDER BY c.relname, pol.polname
  LOOP
    v_sql := format('CREATE POLICY %I ON roldanerp.%I AS %s FOR %s TO %s',
                    r.polname, r.relname,
                    CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                    r.cmd,
                    coalesce(r.roles, 'PUBLIC'));
    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || r.qual || ')';
    END IF;
    IF r.withcheck IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || r.withcheck || ')';
    END IF;
    EXECUTE v_sql;
  END LOOP;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 12) Privilegios (GRANT) y default privileges del schema
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE r record;
BEGIN
  -- 10.a Privilegios sobre el schema
  FOR r IN
    SELECT a.grantee, a.privilege_type, a.is_grantable
    FROM pg_namespace n,
         aclexplode(n.nspacl) a
    WHERE n.nspname = 'mexicana'
  LOOP
    EXECUTE format('GRANT %s ON SCHEMA roldanerp TO %s%s',
                   r.privilege_type,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- 10.b Privilegios sobre tablas, vistas y secuencias
  FOR r IN
    SELECT c.relname, c.relkind, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  LOOP
    EXECUTE format('GRANT %s ON %s roldanerp.%I TO %s%s',
                   r.privilege_type,
                   CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
                   r.relname,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- 10.c Privilegios por columna
  FOR r IN
    SELECT c.relname, att.attname, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_attribute att
    JOIN pg_class c      ON c.oid = att.attrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace,
         aclexplode(att.attacl) a
    WHERE n.nspname = 'mexicana'
      AND att.attnum > 0
      AND NOT att.attisdropped
      AND att.attacl IS NOT NULL
  LOOP
    EXECUTE format('GRANT %s (%I) ON TABLE roldanerp.%I TO %s%s',
                   r.privilege_type, r.attname, r.relname,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- 10.d Privilegios sobre funciones y procedimientos
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           a.grantee, a.privilege_type, a.is_grantable,
           CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(p.proacl) a
    WHERE n.nspname = 'mexicana'
      AND p.prokind IN ('f', 'p', 'w')
  LOOP
    EXECUTE format('GRANT %s ON %s roldanerp.%I(%s) TO %s%s',
                   r.privilege_type, r.kind, r.proname,
                   roldanerp.__clone_rewrite(r.args),
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- 10.e Privilegios sobre tipos y dominios
  FOR r IN
    SELECT t.typname, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace,
         aclexplode(t.typacl) a
    WHERE n.nspname = 'mexicana'
      AND t.typacl IS NOT NULL
      AND t.typtype IN ('e', 'd', 'c')
  LOOP
    EXECUTE format('GRANT %s ON TYPE roldanerp.%I TO %s%s',
                   r.privilege_type, r.typname,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;

  -- 10.f Default privileges del schema (ALTER DEFAULT PRIVILEGES)
  FOR r IN
    SELECT pg_get_userbyid(d.defaclrole) AS owner_role,
           d.defaclobjtype,
           a.grantee, a.privilege_type, a.is_grantable
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace,
         aclexplode(d.defaclacl) a
    WHERE n.nspname = 'mexicana'
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA roldanerp GRANT %s ON %s TO %s%s',
                   r.owner_role,
                   r.privilege_type,
                   CASE r.defaclobjtype
                     WHEN 'r' THEN 'TABLES'
                     WHEN 'S' THEN 'SEQUENCES'
                     WHEN 'f' THEN 'FUNCTIONS'
                     WHEN 'T' THEN 'TYPES'
                     WHEN 'n' THEN 'SCHEMAS'
                   END,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END,
                   CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END
$grants$;

-- ---------------------------------------------------------------------------
-- 13) Comentarios (los de tablas/columnas ya vinieron con LIKE INCLUDING COMMENTS)
-- ---------------------------------------------------------------------------
DO $comments$
DECLARE r record;
BEGIN
  -- Tablas: `LIKE INCLUDING COMMENTS` trae los de columnas y constraints, no el de la tabla.
  FOR r IN
    SELECT c.relname, obj_description(c.oid, 'pg_class') AS cmt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('r', 'p')
      AND obj_description(c.oid, 'pg_class') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON TABLE roldanerp.%I IS %L', r.relname, r.cmt);
  END LOOP;

  -- Índices
  FOR r IN
    SELECT ci.relname, obj_description(ci.oid, 'pg_class') AS cmt
    FROM pg_index i
    JOIN pg_class c      ON c.oid = i.indrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_class ci     ON ci.oid = i.indexrelid
    WHERE n.nspname = 'mexicana'
      AND obj_description(ci.oid, 'pg_class') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_class dci
        JOIN pg_namespace dn ON dn.oid = dci.relnamespace
        WHERE dn.nspname = 'roldanerp' AND dci.relname = ci.relname
      )
  LOOP
    EXECUTE format('COMMENT ON INDEX roldanerp.%I IS %L', r.relname, r.cmt);
  END LOOP;

  -- Vistas, matviews y secuencias
  FOR r IN
    SELECT c.relname, c.relkind, obj_description(c.oid, 'pg_class') AS cmt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('v', 'm', 'S')
      AND obj_description(c.oid, 'pg_class') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON %s roldanerp.%I IS %L',
                   CASE r.relkind WHEN 'v' THEN 'VIEW'
                                  WHEN 'm' THEN 'MATERIALIZED VIEW'
                                  ELSE 'SEQUENCE' END,
                   r.relname, r.cmt);
  END LOOP;

  -- Columnas de vistas y matviews
  FOR r IN
    SELECT c.relname, a.attname, col_description(c.oid, a.attnum) AS cmt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'mexicana'
      AND c.relkind IN ('v', 'm')
      AND col_description(c.oid, a.attnum) IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON COLUMN roldanerp.%I.%I IS %L', r.relname, r.attname, r.cmt);
  END LOOP;

  -- Funciones y procedimientos
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS kind,
           obj_description(p.oid, 'pg_proc') AS cmt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'mexicana'
      AND p.prokind IN ('f', 'p', 'w')
      AND obj_description(p.oid, 'pg_proc') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON %s roldanerp.%I(%s) IS %L',
                   r.kind, r.proname, roldanerp.__clone_rewrite(r.args), r.cmt);
  END LOOP;

  -- Tipos
  FOR r IN
    SELECT t.typname, obj_description(t.oid, 'pg_type') AS cmt
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'mexicana'
      AND t.typtype IN ('e', 'd', 'c')
      AND obj_description(t.oid, 'pg_type') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON TYPE roldanerp.%I IS %L', r.typname, r.cmt);
  END LOOP;

  -- Constraints
  FOR r IN
    SELECT c.conname, t.relname, obj_description(c.oid, 'pg_constraint') AS cmt
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    WHERE n.nspname = 'mexicana'
      AND obj_description(c.oid, 'pg_constraint') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON CONSTRAINT %I ON roldanerp.%I IS %L', r.conname, r.relname, r.cmt);
  END LOOP;

  -- Políticas RLS
  FOR r IN
    SELECT pol.polname, c.relname, obj_description(pol.oid, 'pg_policy') AS cmt
    FROM pg_policy pol
    JOIN pg_class c      ON c.oid = pol.polrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'mexicana'
      AND obj_description(pol.oid, 'pg_policy') IS NOT NULL
  LOOP
    EXECUTE format('COMMENT ON POLICY %I ON roldanerp.%I IS %L', r.polname, r.relname, r.cmt);
  END LOOP;
END
$comments$;

-- ---------------------------------------------------------------------------
-- 13.b Valores que NOMBRAN al schema (no son referencias SQL, son datos)
--      `empresas.data_schema` guarda el nombre del schema del tenant y la app lo lee.
--      El resto de los literales de texto se deja intacto a propósito: reescribirlos
--      a ciegas podría pisar datos de negocio. Si queda alguno, se avisa por NOTICE.
-- ---------------------------------------------------------------------------
DO $tenant_vals$
DECLARE r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c      ON c.oid = a.attrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empresas'
      AND a.attname = 'data_schema' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    ALTER TABLE roldanerp.empresas ALTER COLUMN data_schema SET DEFAULT 'roldanerp';
    RAISE NOTICE 'empresas.data_schema DEFAULT -> roldanerp';
  END IF;

  FOR r IN
    SELECT c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attrdef d
    JOIN pg_class c      ON c.oid = d.adrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_attribute a  ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE n.nspname = 'roldanerp'
      AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%mexicana%'
  LOOP
    RAISE NOTICE 'REVISAR: el DEFAULT de roldanerp.%.% todavía dice "mexicana": %',
      r.relname, r.attname, r.def;
  END LOOP;
END
$tenant_vals$;

-- ---------------------------------------------------------------------------
-- 14) Limpieza del helper + resumen
-- ---------------------------------------------------------------------------
DROP FUNCTION roldanerp.__clone_rewrite(text);

DO $resumen$
DECLARE
  v_t_src int; v_t_dst int;
  v_v_src int; v_v_dst int;
  v_f_src int; v_f_dst int;
  v_i_src int; v_i_dst int;
  v_c_src int; v_c_dst int;
  v_p_src int; v_p_dst int;
  v_g_src int; v_g_dst int;
BEGIN
  SELECT count(*) INTO v_t_src FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='mexicana'  AND c.relkind IN ('r','p');
  SELECT count(*) INTO v_t_dst FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relkind IN ('r','p');

  SELECT count(*) INTO v_v_src FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='mexicana'  AND c.relkind IN ('v','m');
  SELECT count(*) INTO v_v_dst FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='roldanerp' AND c.relkind IN ('v','m');

  SELECT count(*) INTO v_f_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='mexicana';
  SELECT count(*) INTO v_f_dst FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='roldanerp';

  SELECT count(*) INTO v_i_src FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mexicana';
  SELECT count(*) INTO v_i_dst FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='roldanerp';

  SELECT count(*) INTO v_c_src FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='mexicana';
  SELECT count(*) INTO v_c_dst FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='roldanerp';

  SELECT count(*) INTO v_p_src FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mexicana';
  SELECT count(*) INTO v_p_dst FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='roldanerp';

  SELECT count(*) INTO v_g_src FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mexicana' AND NOT tg.tgisinternal;
  SELECT count(*) INTO v_g_dst FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='roldanerp' AND NOT tg.tgisinternal;

  RAISE NOTICE '--- Clon mexicana -> roldanerp ---';
  RAISE NOTICE 'Tablas:      % -> %', v_t_src, v_t_dst;
  RAISE NOTICE 'Vistas:      % -> %', v_v_src, v_v_dst;
  RAISE NOTICE 'Funciones:   % -> %', v_f_src, v_f_dst;
  RAISE NOTICE 'Indices:     % -> %', v_i_src, v_i_dst;
  RAISE NOTICE 'Constraints: % -> %', v_c_src, v_c_dst;
  RAISE NOTICE 'Politicas:   % -> %', v_p_src, v_p_dst;
  RAISE NOTICE 'Triggers:    % -> %', v_g_src, v_g_dst;

  IF v_t_src <> v_t_dst THEN
    RAISE EXCEPTION 'Faltan tablas en el clon (% vs %). Se revierte todo.', v_t_src, v_t_dst;
  END IF;
END
$resumen$;

COMMIT;
