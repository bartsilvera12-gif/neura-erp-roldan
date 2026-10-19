-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 06 · Habilitar un módulo que no venía en el set inicial
-- ============================================================================
--
-- La instancia arranca con 12 módulos y `empresa_modulos` es la única fuente de
-- verdad (NEURA_INSTANCE_MODE=single_client). Habilitar uno más NO requiere
-- tocar código ni redeployar: alcanza con la fila de este script.
--
-- Tal como está, habilita **Planes**, que es lo que pide el CRM para cargar
-- "servicios / productos de interés" en un lead. Para habilitar otro módulo,
-- cambiá `v_slug` por el que corresponda:
--
--   usuarios · configuracion · presupuestos · gastos · reportes · comisiones
--   notas_credito · gestion-clientes · marketing · marketing_ops · campanas
--   sorteos · proyectos · recetas · reposicion · notas_remision · ordenes_venta
--   historial-omnicanal · conversaciones-finalizadas · monitoreo
--
-- Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $habilitar$
DECLARE
  v_slug    text := 'planes';          -- ← el módulo a habilitar
  v_nombre  text := 'Planes';          -- ← su nombre visible, si hay que crearlo
  v_empresa uuid;
  v_modulo  uuid;
  v_n       int;
BEGIN
  -- Instancia monocliente: tiene que haber exactamente una empresa.
  SELECT count(*) INTO v_n FROM roldanerp.empresas;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No hay empresa en `roldanerp`. Correr primero el script 02.';
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'Hay % empresas en `roldanerp`. Esta instancia es monocliente: revisar.', v_n;
  END IF;
  SELECT id INTO v_empresa FROM roldanerp.empresas;

  -- El módulo tiene que existir en el catálogo.
  SELECT id INTO v_modulo FROM roldanerp.modulos WHERE slug = v_slug;
  IF v_modulo IS NULL THEN
    INSERT INTO roldanerp.modulos (id, nombre, slug)
    VALUES (gen_random_uuid(), v_nombre, v_slug)
    RETURNING id INTO v_modulo;
    RAISE NOTICE 'Módulo % agregado al catálogo.', v_slug;
  END IF;

  -- Habilitarlo para la empresa.
  IF EXISTS (
    SELECT 1 FROM roldanerp.empresa_modulos
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo
  ) THEN
    UPDATE roldanerp.empresa_modulos SET activo = true
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo;
  ELSE
    INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
    VALUES (v_empresa, v_modulo, true);
  END IF;

  -- Y para el usuario, que es la otra mitad del gate.
  INSERT INTO roldanerp.usuario_modulos (usuario_id, modulo_id)
  SELECT u.id, v_modulo
  FROM roldanerp.usuarios u
  WHERE u.empresa_id = v_empresa
    AND NOT EXISTS (
      SELECT 1 FROM roldanerp.usuario_modulos um
      WHERE um.usuario_id = u.id AND um.modulo_id = v_modulo
    );

  RAISE NOTICE 'Módulo % habilitado para la empresa %.', v_slug, v_empresa;
END
$habilitar$;

-- Módulos activos después de correr esto.
SELECT m.slug, m.nombre
  FROM roldanerp.empresa_modulos em
  JOIN roldanerp.modulos m ON m.id = em.modulo_id
 WHERE em.activo
 ORDER BY m.slug;

COMMIT;

-- No hace falta recargar PostgREST: no se creó ninguna tabla, solo filas.
