-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 14 · Habilitar los módulos Reportes y Gastos
-- ============================================================================
--
-- YA SE APLICÓ EN LA BASE el 22-10-2026. Queda acá para que el estado del
-- schema sea reproducible y para poder rehacerlo si alguna vez se reconstruye.
-- Correrlo de nuevo no hace nada.
--
-- POR QUÉ
--   El QA pedía reportes de ventas, proveedores, conciliación bancaria,
--   estado de cuenta y cierres de caja. Las pantallas YA existen en el código
--   (/reportes/*), pero el módulo `reportes` ni siquiera estaba en el catálogo
--   `modulos`, así que el gate lo bloqueaba y no aparecía en el menú.
--
--   `gastos` se habilita por lo mismo: el libro mayor tenía que mostrar
--   asientos de "Compras y Gastos y Servicios" y el módulo estaba apagado.
--
-- UN MÓDULO SE HABILITA EN TRES LUGARES
--   1. `modulos`          — el catálogo global: qué módulos existen.
--   2. `empresa_modulos`  — qué contrató la empresa.
--   3. `usuario_modulos`  — a qué accede cada usuario.
--
--   Los tres hacen falta: el acceso efectivo es la intersección. Si
--   `usuario_modulos` está vacío para un usuario, se asume "todo lo de la
--   empresa"; pero este usuario tiene filas, así que había que agregarlo ahí
--   también o el módulo quedaba habilitado y aun así invisible.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $mods$
DECLARE
  v_empresa uuid;
  r         record;
  v_mid     uuid;
  v_n       int := 0;
BEGIN
  SELECT id INTO v_empresa FROM roldanerp.empresas LIMIT 1;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'No hay empresa en `roldanerp`. Correr primero el script 02.';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('reportes', 'Reportes', 'Ventas, compras, proveedores, tesorería, conciliación y estado de cuenta.'),
      ('gastos',   'Gastos',   'Registro de gastos y servicios.')
    ) AS v(slug, nombre, descripcion)
  LOOP
    -- 1) Catálogo. Sin ON CONFLICT: no hay garantía de índice único en `slug`.
    SELECT id INTO v_mid FROM roldanerp.modulos WHERE slug = r.slug LIMIT 1;
    IF v_mid IS NULL THEN
      INSERT INTO roldanerp.modulos (slug, nombre, descripcion)
      VALUES (r.slug, r.nombre, r.descripcion)
      RETURNING id INTO v_mid;
      v_n := v_n + 1;
    END IF;

    -- 2) La empresa lo tiene.
    IF NOT EXISTS (
      SELECT 1 FROM roldanerp.empresa_modulos
       WHERE empresa_id = v_empresa AND modulo_id = v_mid
    ) THEN
      INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
      VALUES (v_empresa, v_mid, true);
    ELSE
      UPDATE roldanerp.empresa_modulos SET activo = true
       WHERE empresa_id = v_empresa AND modulo_id = v_mid;
    END IF;

    -- 3) Cada usuario que ya tenga asignaciones explícitas. A los que no
    --    tienen ninguna no se les toca nada: para ellos vale "todo lo de la
    --    empresa", y agregarles una fila los convertiría en restringidos.
    INSERT INTO roldanerp.usuario_modulos (usuario_id, modulo_id)
    SELECT u.id, v_mid
      FROM roldanerp.usuarios u
     WHERE u.empresa_id = v_empresa
       AND EXISTS (SELECT 1 FROM roldanerp.usuario_modulos um WHERE um.usuario_id = u.id)
       AND NOT EXISTS (
         SELECT 1 FROM roldanerp.usuario_modulos um
          WHERE um.usuario_id = u.id AND um.modulo_id = v_mid
       );
  END LOOP;

  RAISE NOTICE 'Modulos creados en el catalogo: %. Reportes y Gastos habilitados.', v_n;
END
$mods$;

-- Chequeo final.
DO $check$
DECLARE v_faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM roldanerp.empresa_modulos em
    JOIN roldanerp.modulos m ON m.id = em.modulo_id
    WHERE m.slug = 'reportes' AND em.activo
  ) THEN v_faltan := v_faltan || ' reportes'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM roldanerp.empresa_modulos em
    JOIN roldanerp.modulos m ON m.id = em.modulo_id
    WHERE m.slug = 'gastos' AND em.activo
  ) THEN v_faltan := v_faltan || ' gastos'; END IF;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'No quedaron habilitados:%', v_faltan;
  END IF;
  RAISE NOTICE 'OK: Reportes y Gastos activos para la empresa.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
