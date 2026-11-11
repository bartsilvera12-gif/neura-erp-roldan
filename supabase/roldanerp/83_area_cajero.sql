-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 83 · "Cajero" como área del usuario
-- ============================================================================
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
--   La ficha del usuario ofrecía cinco áreas: Ventas, Soporte, Finanzas,
--   Operaciones y Administración. El que atiende la caja no es ninguna: no es
--   un vendedor, y meterlo en Finanzas lo pone en la misma bolsa que quien
--   maneja la plata de la empresa.
--
-- ── POR QUÉ HACE FALTA ESTE SCRIPT ─────────────────────────────────────────
--   La columna `area` tiene un CHECK con la lista de áreas escrita adentro.
--   Agregar la opción en la pantalla no alcanza: al guardar, la base rechaza
--   el valor y el usuario ve un error sin entender por qué. Hay que ampliar
--   el CHECK, y eso solo se hace desde acá.
--
--   El constraint se busca por su DEFINICIÓN y no por su nombre: lo creó un
--   `ADD COLUMN ... CHECK (...)` sin nombrarlo, así que Postgres le puso uno
--   automático que no es igual en todas las bases.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $cajero$
DECLARE
  r record;
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.usuarios.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'usuarios' AND column_name = 'area'
  ) THEN
    RAISE EXCEPTION 'roldanerp.usuarios no tiene la columna `area`.';
  END IF;

  -- Fuera el CHECK viejo, sea cual sea su nombre.
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'roldanerp.usuarios'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%area%'
       AND pg_get_constraintdef(oid) ILIKE '%ventas%'
  LOOP
    EXECUTE format('ALTER TABLE roldanerp.usuarios DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Se quitó el CHECK anterior: %', r.conname;
  END LOOP;

  -- Y el nuevo, con nombre propio para que la próxima vez se encuentre solo.
  ALTER TABLE roldanerp.usuarios
    ADD CONSTRAINT usuarios_area_chk
    CHECK (area IS NULL OR area IN (
      'ventas', 'cajero', 'soporte', 'finanzas', 'operaciones', 'administracion'
    ));
END
$cajero$;

COMMENT ON COLUMN roldanerp.usuarios.area IS
  'Área funcional. "cajero" es quien atiende la caja: no es vendedor, y en '
  'Finanzas quedaba junto al que maneja la plata de la empresa.';

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  coalesce(area, '(sin área)') AS area,
  count(*)                     AS usuarios
FROM roldanerp.usuarios
GROUP BY area
ORDER BY usuarios DESC;
