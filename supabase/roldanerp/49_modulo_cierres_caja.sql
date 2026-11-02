-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 49 · Módulo "Cierres de caja" (el permiso del supervisor)
-- ============================================================================
--
-- ── LO QUE SE PIDIÓ ───────────────────────────────────────────────────────
--   "Un supervisor puede entrar solo a reportes de cierres de caja, donde
--   pueda ver y anular las facturas."
--
-- ── POR QUÉ HACE FALTA UN MÓDULO NUEVO ────────────────────────────────────
--   Hasta ahora TODA la reportería vivía detrás de un único permiso,
--   `reportes`: quien lo tenía veía los cierres de caja y también la
--   rentabilidad por producto, los márgenes, las ganancias del mes y las
--   modificaciones administrativas. No había forma de dar lo primero sin dar
--   lo demás.
--
--   `cierres-caja` es un sub-permiso de Reportes: cubre /reportes/cajas y
--   nada más. Quien tiene `reportes` completo sigue entrando a los cierres
--   igual que antes —eso lo resuelve el código, no este script—, así que
--   correr esto no le quita el acceso a nadie.
--
-- ── QUÉ HAY QUE HACER DESPUÉS DE CORRERLO ─────────────────────────────────
--   Nada obligatorio. El tope del supervisor lo pone el rol en el código: un
--   usuario con rol `supervisor` ve solo los cierres de caja, aunque tenga
--   más módulos asignados. Este script existe para que el permiso también se
--   pueda dar o quitar desde Usuarios, como cualquier otro módulo.
--
--   Lo que sí hay que hacer: cerrar sesión y volver a entrar. El menú guarda
--   los permisos en el navegador.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.modulos') IS NULL
     OR to_regclass('roldanerp.empresa_modulos') IS NULL THEN
    RAISE EXCEPTION 'Faltan roldanerp.modulos o roldanerp.empresa_modulos. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Catálogo
-- ---------------------------------------------------------------------------
INSERT INTO roldanerp.modulos (nombre, slug, descripcion)
SELECT v.nombre, v.slug, v.descripcion
  FROM (VALUES
    ('Cierres de caja', 'cierres-caja',
     'Arqueo de cada turno: ventas, movimientos y diferencia. Permite anular facturas del turno. Es el permiso del supervisor.')
  ) AS v(nombre, slug, descripcion)
 WHERE NOT EXISTS (
   SELECT 1 FROM roldanerp.modulos m WHERE m.slug = v.slug
 );

-- ---------------------------------------------------------------------------
-- 2) Activarlo para la empresa
-- ---------------------------------------------------------------------------
--   Se activa para todas las empresas del esquema (en esta instancia hay una
--   sola; escribirlo así evita pegar un uuid a mano). Si la fila existe pero
--   quedó en `activo = false`, se reactiva.
WITH nuevos AS (
  SELECT m.id AS modulo_id, e.id AS empresa_id
    FROM roldanerp.modulos m
    CROSS JOIN roldanerp.empresas e
   WHERE m.slug = 'cierres-caja'
)
INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT n.empresa_id, n.modulo_id, true
  FROM nuevos n
 WHERE NOT EXISTS (
   SELECT 1 FROM roldanerp.empresa_modulos em
    WHERE em.empresa_id = n.empresa_id AND em.modulo_id = n.modulo_id
 );

UPDATE roldanerp.empresa_modulos em
   SET activo = true
  FROM roldanerp.modulos m
 WHERE m.id = em.modulo_id
   AND m.slug = 'cierres-caja'
   AND em.activo IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- 3) Dárselo a quien ya tiene Reportes asignado explícitamente
-- ---------------------------------------------------------------------------
--   Si un usuario tiene módulos asignados uno por uno (`usuario_modulos`) y
--   entre ellos está `reportes`, se le agrega también `cierres-caja`. No le
--   da nada nuevo —con `reportes` ya entraba a los cierres— pero deja la
--   asignación explícita, así la pantalla de Usuarios muestra la realidad en
--   vez de un permiso que funciona "por herencia".
--
--   A los usuarios SIN filas en `usuario_modulos` no se les toca nada: esos
--   heredan todos los módulos de la empresa, y el nuevo entra solo.
DO $usuarios$
BEGIN
  IF to_regclass('roldanerp.usuario_modulos') IS NULL THEN
    RAISE NOTICE 'No existe roldanerp.usuario_modulos: se omite el paso 3.';
    RETURN;
  END IF;

  INSERT INTO roldanerp.usuario_modulos (usuario_id, modulo_id)
  SELECT um.usuario_id, nuevo.id
    FROM roldanerp.usuario_modulos um
    JOIN roldanerp.modulos rep   ON rep.id = um.modulo_id AND rep.slug = 'reportes'
    CROSS JOIN roldanerp.modulos nuevo
   WHERE nuevo.slug = 'cierres-caja'
     AND NOT EXISTS (
       SELECT 1 FROM roldanerp.usuario_modulos ya
        WHERE ya.usuario_id = um.usuario_id AND ya.modulo_id = nuevo.id
     );
END
$usuarios$;

-- ---------------------------------------------------------------------------
-- 4) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_id uuid;
  v_activos int;
BEGIN
  SELECT id INTO v_id FROM roldanerp.modulos WHERE slug = 'cierres-caja';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No quedo registrado el modulo cierres-caja en el catalogo.';
  END IF;

  SELECT count(*) INTO v_activos
    FROM roldanerp.empresa_modulos em
   WHERE em.modulo_id = v_id AND em.activo IS TRUE;
  IF v_activos = 0 THEN
    RAISE EXCEPTION 'El modulo cierres-caja no quedo activo para ninguna empresa.';
  END IF;

  RAISE NOTICE 'Listo: Cierres de caja activo para % empresa(s).', v_activos;
  RAISE NOTICE 'Cerra sesion y volve a entrar: el menu guarda los permisos en el navegador.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
