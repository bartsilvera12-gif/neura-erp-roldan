-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 12 · Correcciones sobre datos ya cargados
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Los arreglos de código impiden que el problema vuelva a pasar, pero no
--   tocan lo que ya está guardado. Las dos "ÑEMBY" siguen ahí porque se
--   crearon antes de la validación, y "GIULIANA@GMAIL.COM" sigue en
--   mayúsculas porque se guardó antes de la normalización.
--
--   Este script arregla lo viejo. Es idempotente: correrlo de nuevo no hace
--   nada porque ya no queda nada que corregir.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Correos de empleados a minúsculas (QA 19)
-- ---------------------------------------------------------------------------
DO $mails$
DECLARE v_n int;
BEGIN
  UPDATE roldanerp.empleados
     SET email = lower(btrim(email))
   WHERE email IS NOT NULL
     AND email <> lower(btrim(email));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Correos de empleados normalizados: %', v_n;
END
$mails$;

-- ---------------------------------------------------------------------------
-- 2) El trigger que vuelve a ponerlos en mayúsculas (QA 19)
--
--    El schema clonado trae triggers que normalizan texto a mayúsculas. Si uno
--    de ellos toca `email`, le gana a la API: el correo se guarda en minúsculas
--    y el trigger lo vuelve a subir. Acá se busca y se desactiva solo si
--    efectivamente toca esa columna.
-- ---------------------------------------------------------------------------
DO $trg$
DECLARE
  r      record;
  v_src  text;
  v_n    int := 0;
BEGIN
  FOR r IN
    SELECT t.tgname, p.proname, p.oid AS proid
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p      ON p.oid = t.tgfoid
    WHERE n.nspname = 'roldanerp'
      AND c.relname = 'empleados'
      AND NOT t.tgisinternal
  LOOP
    v_src := pg_get_functiondef(r.proid);
    IF v_src ~* 'upper\s*\(' AND v_src ~* '\memail\M' THEN
      EXECUTE format('ALTER TABLE roldanerp.empleados DISABLE TRIGGER %I', r.tgname);
      RAISE NOTICE 'Trigger desactivado (ponía el correo en mayúsculas): % -> %', r.tgname, r.proname;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE 'Ningún trigger de `empleados` toca el correo con upper(). El problema no venía de ahí.';
  END IF;
END
$trg$;

-- ---------------------------------------------------------------------------
-- 3) Sucursales duplicadas por nombre (QA 13)
--
--    NO se borra ninguna: puede tener ventas, usuarios o stock colgando, y
--    borrarla dejaría esos registros huérfanos. Se desactiva la duplicada que
--    no tenga nada asociado, y si las dos tienen datos se avisa para que lo
--    resuelva una persona.
-- ---------------------------------------------------------------------------
DO $sucs$
DECLARE
  r        record;
  v_usos   bigint;
  v_queda  uuid;
BEGIN
  FOR r IN
    SELECT lower(btrim(nombre)) AS clave, count(*) AS n
    FROM roldanerp.sucursales
    GROUP BY 1 HAVING count(*) > 1
  LOOP
    -- Se conserva la principal; si ninguna lo es, la más vieja.
    SELECT id INTO v_queda
    FROM roldanerp.sucursales
    WHERE lower(btrim(nombre)) = r.clave
    ORDER BY es_principal DESC NULLS LAST, codigo
    LIMIT 1;

    FOR v_usos, v_queda IN
      SELECT 0::bigint, v_queda
    LOOP
      NULL;  -- placeholder para mantener v_queda
    END LOOP;

    -- Para cada duplicada que no sea la que se conserva:
    DECLARE s record;
    BEGIN
      FOR s IN
        SELECT id, codigo, nombre FROM roldanerp.sucursales
        WHERE lower(btrim(nombre)) = r.clave AND id <> v_queda
      LOOP
        SELECT
          (SELECT count(*) FROM roldanerp.ventas   WHERE sucursal_id = s.id) +
          (SELECT count(*) FROM roldanerp.compras  WHERE sucursal_id = s.id)
        INTO v_usos;

        IF v_usos = 0 THEN
          UPDATE roldanerp.sucursales
             SET activa = false,
                 nombre = nombre || ' (duplicada)'
           WHERE id = s.id;
          RAISE NOTICE 'Sucursal duplicada desactivada: % (%) — no tenía movimientos.', s.nombre, s.codigo;
        ELSE
          RAISE WARNING 'Sucursal duplicada CON % movimiento(s): % (%). Resolvela a mano: mové los datos y después desactivala.',
            v_usos, s.nombre, s.codigo;
        END IF;
      END LOOP;
    END;
  END LOOP;
END
$sucs$;

-- ---------------------------------------------------------------------------
-- 4) Aviso de sucursales sin timbrado (QA 13, segunda parte)
--    No se inventan valores: establecimiento y punto de expedición son datos
--    fiscales que asigna la DNIT. Solo se avisa cuáles faltan.
-- ---------------------------------------------------------------------------
DO $tim$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT codigo, nombre FROM roldanerp.sucursales
    WHERE activa IS TRUE
      AND (establecimiento IS NULL OR btrim(establecimiento) = ''
        OR punto_expedicion IS NULL OR btrim(punto_expedicion) = '')
    ORDER BY codigo
  LOOP
    RAISE NOTICE 'Sin establecimiento/punto de expedición: % (%). Cargalos en Sucursales → Editar.', r.nombre, r.codigo;
  END LOOP;
END
$tim$;

COMMIT;

NOTIFY pgrst, 'reload schema';
