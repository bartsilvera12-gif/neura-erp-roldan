-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 56 · Rubros padre y la remarcación del grupo
-- ============================================================================
--
-- ── QUÉ HACE ──────────────────────────────────────────────────────────────
--   1. Crea los rubros padre que faltan y cuelga de cada uno sus grupos
--      (`parent_id`). Dos niveles: rubro mayor → grupos, como se definió.
--   2. Agrega `categorias_productos.markup_pct`: la remarcación del rubro, que
--      hasta ahora vivía SOLO como una nota de texto en `descripcion`.
--
-- ── QUÉ *NO* HACE: NO TOCA NINGÚN PRECIO ──────────────────────────────────
--   `productos.markup_pct` y `productos.precio_venta` están guardados por
--   separado y nada recalcula uno desde el otro. Este script escribe la
--   remarcación del RUBRO, que de acá en más es el valor de referencia del
--   grupo y el que toman los productos nuevos. Los 1.002 productos que ya
--   existen quedan exactamente con el precio que tienen hoy.
--
--   Bajar los precios de los productos ya cargados a la remarcación del grupo
--   es el script 57, que va aparte justamente porque eso sí es irreversible y
--   mueve plata: son 192 productos y Gs. 3.202.046 menos de precio de lista.
--
-- ── POR QUÉ LA REMARCACIÓN DEL GRUPO NO ES LA DE SUS PRODUCTOS ────────────
--   Medido sobre la base real: dentro de un mismo rubro conviven hasta ocho
--   remarcaciones distintas. CHAPA NEGRA tiene productos al 10%, 20%, 29,94%,
--   35,43% y 35,77%. Eso no es desprolijidad: son precios que alguien levantó
--   a propósito, producto por producto. La remarcación del rubro es la tarifa
--   base con la que se carga lo nuevo, no lo que se cobra por todo.
--
-- ── EL VALOR QUE SE LE PONE A CADA PADRE ──────────────────────────────────
--   El que tienen MÁS productos dentro del grupo, que es el que menos cosas
--   contradice. Se puede cambiar después desde la pantalla.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

ALTER TABLE roldanerp.categorias_productos
  ADD COLUMN IF NOT EXISTS markup_pct numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'categorias_productos_markup_chk'
       AND conrelid = 'roldanerp.categorias_productos'::regclass
  ) THEN
    ALTER TABLE roldanerp.categorias_productos
      ADD CONSTRAINT categorias_productos_markup_chk
      CHECK (markup_pct IS NULL OR markup_pct >= 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.categorias_productos.markup_pct IS
  'Remarcacion de referencia del rubro, en %. La heredan las subcategorias que no tengan la suya. NULL = sin definir.';

-- ---------------------------------------------------------------------------
-- El árbol
-- ---------------------------------------------------------------------------
DO $arbol$
DECLARE
  v_empresa uuid;
  v_padre   uuid;
  r         record;
  -- Cada fila: rubro padre, su remarcación de referencia, y sus grupos.
  grupos    text[][] := ARRAY[
    ARRAY['CAÑOS',                '19.50', 'CAÑOS REDONDOS|CAÑOS CUADRADOS|CAÑOS RECTANGULARES|CAÑO GALVANIZADO'],
    ARRAY['CHAPAS LISAS',         '20.00', 'CHAPA NEGRA|CHAPA GALVANIZADA'],
    ARRAY['CHAPAS ACANALADAS',    '16.00', 'CHAPA ACANALADA|CHAPA ACANALADA COLOR|CHAPA ACANALADA MEDIDAS ESPECIALES'],
    ARRAY['CHAPAS TRAPEZOIDALES', '14.00', 'CHAPA TRAPEZOIDAL|CHAPA TRAPEZOIDAL COLOR|CHAPA TRAPEZOIDAL MEDIDAS ESPECIALES|CHAPA TRAPEZIO Nº 0.25|CHAPA TRAPEZIO Nº 28|CHAPA TRAPEZIO Nº 30|CHAPA TRAPEZIO MED ESPECIAL'],
    ARRAY['CHAPAS TEJA',          '25.00', 'CHAPA TEJA ESPAÑOLA|CHAPA TEJA FRANCESA|CHAPA TEJA HOLANDESA'],
    ARRAY['CHAPAS ESPECIALES',    '17.00', 'CHAPA ANTIDESLIZANTE|CHAPA EXPANDIDA|CHAPA FRIZADA|CHAPA POLICARBONATO|CHAPA TRASLUCIDA|CHAPA  TERMOPANEL'],
    ARRAY['PERFILES',             '20.00', 'PERFIL C|PERFIL U|IPN|UPN|HIERRO T|ANGULOS'],
    ARRAY['VARILLAS',             '19.50', 'VARILLA CONFORMADA|VARILLA CUADRADA|VARILLA LISA'],
    ARRAY['PRODUCCION PROPIA',    '16.00', 'PRODUCCION|PRODUCCION MEDIDA ESPECIAL']
  ];
  i         int;
  nombre_p  text;
  rem_p     numeric;
  hijos     text[];
  h         text;
  n_colg    int := 0;
  n_falta   int := 0;
BEGIN
  SELECT id INTO v_empresa FROM roldanerp.empresas
   WHERE id = '9f3c1d60-4e2a-4d7b-9a81-6c05b7e41f23'::uuid;
  IF v_empresa IS NULL THEN
    SELECT empresa_id INTO v_empresa FROM roldanerp.categorias_productos LIMIT 1;
  END IF;
  IF v_empresa IS NULL THEN
    RAISE NOTICE 'No hay rubros cargados: no hay nada que organizar.';
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(grupos, 1) LOOP
    nombre_p := grupos[i][1];
    rem_p    := grupos[i][2]::numeric;
    hijos    := string_to_array(grupos[i][3], '|');

    -- El padre: si ya existe se reusa (CAÑOS ya estaba, vacío). Si no, se crea.
    SELECT id INTO v_padre
      FROM roldanerp.categorias_productos
     WHERE empresa_id = v_empresa AND upper(btrim(nombre)) = upper(btrim(nombre_p))
     LIMIT 1;

    IF v_padre IS NULL THEN
      INSERT INTO roldanerp.categorias_productos (empresa_id, nombre, activo, markup_pct, descripcion)
      VALUES (v_empresa, nombre_p, true, rem_p,
              'Rubro padre (script 56). Remarcacion de referencia del grupo.')
      RETURNING id INTO v_padre;
    ELSE
      -- No se pisa una remarcación ya cargada a mano.
      UPDATE roldanerp.categorias_productos
         SET markup_pct = COALESCE(markup_pct, rem_p),
             activo = true,
             updated_at = now()
       WHERE id = v_padre;
    END IF;

    -- Un padre no puede colgar de sí mismo ni de uno de sus hijos.
    UPDATE roldanerp.categorias_productos
       SET parent_id = NULL, updated_at = now()
     WHERE id = v_padre AND parent_id IS NOT NULL;

    FOREACH h IN ARRAY hijos LOOP
      UPDATE roldanerp.categorias_productos
         SET parent_id = v_padre, updated_at = now()
       WHERE empresa_id = v_empresa
         AND upper(btrim(nombre)) = upper(btrim(h))
         AND id <> v_padre
         AND (parent_id IS DISTINCT FROM v_padre);
      IF FOUND THEN
        n_colg := n_colg + 1;
      ELSIF NOT EXISTS (
        SELECT 1 FROM roldanerp.categorias_productos
         WHERE empresa_id = v_empresa AND upper(btrim(nombre)) = upper(btrim(h))
      ) THEN
        n_falta := n_falta + 1;
        RAISE NOTICE 'No existe el rubro "%": no se colgo de %.', h, nombre_p;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Grupos colgados de su rubro padre: %.', n_colg;
  IF n_falta > 0 THEN
    RAISE NOTICE 'Rubros nombrados que no existen en la base: %.', n_falta;
  END IF;
END
$arbol$;

-- ---------------------------------------------------------------------------
-- La remarcación de cada grupo, desde la nota que dejó la migración
-- ---------------------------------------------------------------------------
--   La migración escribió "Remarcacion minorista del sistema viejo: 19.50%." en
--   `descripcion`. Ese dato estaba ahí sin que nada lo pudiera leer. Se pasa a
--   la columna, que es donde sirve.
UPDATE roldanerp.categorias_productos c
   SET markup_pct = NULLIF(
         regexp_replace(
           substring(c.descripcion from 'minorista del sistema viejo: ([0-9]+\.?[0-9]*)%'),
           '[^0-9.]', '', 'g'
         ), ''
       )::numeric,
       updated_at = now()
 WHERE c.markup_pct IS NULL
   AND c.descripcion LIKE '%minorista del sistema viejo:%';

COMMIT;

-- ---------------------------------------------------------------------------
-- Cómo quedó
-- ---------------------------------------------------------------------------
DO $resumen$
DECLARE
  r record;
  v_sin_rem int;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'ARBOL DE RUBROS:';
  FOR r IN
    SELECT p.nombre AS padre,
           p.markup_pct AS rem_padre,
           count(h.id) AS hijos
      FROM roldanerp.categorias_productos p
      LEFT JOIN roldanerp.categorias_productos h ON h.parent_id = p.id
     WHERE p.parent_id IS NULL
     GROUP BY p.nombre, p.markup_pct
    HAVING count(h.id) > 0
     ORDER BY p.nombre
  LOOP
    RAISE NOTICE '  % (rem %) -> % grupos', r.padre, coalesce(r.rem_padre::text, 'sin definir'), r.hijos;
  END LOOP;

  SELECT count(*) INTO v_sin_rem FROM roldanerp.categorias_productos WHERE markup_pct IS NULL AND activo;
  RAISE NOTICE '';
  RAISE NOTICE 'Rubros activos sin remarcacion de referencia: %.', v_sin_rem;
  RAISE NOTICE 'NINGUN PRECIO DE PRODUCTO FUE MODIFICADO por este script.';
END
$resumen$;

NOTIFY pgrst, 'reload schema';
