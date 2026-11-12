-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 85 · Dar de alta y habilitar el módulo "Conversaciones finalizadas"
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "También el de finalizados, también de omnicanal."
--
-- ── POR QUÉ NO ALCANZABA CON ACTIVARLO ─────────────────────────────────────
--   Igual que con Gestión Clientes: la pantalla ya estaba construida y las
--   cuatro tablas que usa ya existían, pero el módulo NO ESTABA EN EL
--   CATÁLOGO. Sin una fila en `modulos` no hay qué activar, porque
--   `empresa_modulos` apunta a un módulo por su id.
--
--   Así que este script hace las dos cosas: lo da de alta en el catálogo y lo
--   habilita para la empresa.
--
-- ── QUÉ ES ESA PANTALLA ────────────────────────────────────────────────────
--   Los chats que ya se cerraron, con el motivo de cierre de cada uno. Es el
--   otro lado de la bandeja: la bandeja muestra lo que falta atender y esta
--   pantalla lo que se atendió, para poder mirar después qué se resolvió y
--   qué no.
--
--   Hoy no hay ningún cierre registrado, y es lo esperable: sin el módulo
--   habilitado nadie pudo cerrar un chat todavía. La pantalla se va a ir
--   llenando a medida que se use.
--
-- ── A QUIÉN LE APARECE ─────────────────────────────────────────────────────
--   A los administradores, que ven todos los módulos activos de la empresa.
--   Al resto NO, hasta que se le tilde en su ficha de usuario.
--
-- ── SE PUEDE DESHACER ──────────────────────────────────────────────────────
--   UPDATE roldanerp.empresa_modulos SET activo = false
--    WHERE modulo_id = (SELECT id FROM roldanerp.modulos WHERE slug = 'conversaciones-finalizadas');
--
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.modulos') IS NULL OR to_regclass('roldanerp.empresa_modulos') IS NULL THEN
    RAISE EXCEPTION 'Faltan roldanerp.modulos / roldanerp.empresa_modulos.';
  END IF;
END
$guard$;

-- 1) El módulo en el catálogo. Si ya está, no se duplica.
INSERT INTO roldanerp.modulos (slug, nombre, descripcion)
SELECT 'conversaciones-finalizadas',
       'Conversaciones finalizadas',
       'Los chats ya cerrados, con el motivo de cierre de cada uno. Es el otro lado de la bandeja: acá queda lo que se atendió.'
 WHERE NOT EXISTS (SELECT 1 FROM roldanerp.modulos WHERE slug = 'conversaciones-finalizadas');

-- 2) Habilitado para la empresa. Si ya tenía fila, se reactiva.
INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
  FROM roldanerp.empresas e
  CROSS JOIN roldanerp.modulos m
 WHERE m.slug = 'conversaciones-finalizadas'
   AND NOT EXISTS (
     SELECT 1 FROM roldanerp.empresa_modulos em
      WHERE em.empresa_id = e.id AND em.modulo_id = m.id);

UPDATE roldanerp.empresa_modulos em
   SET activo = true
  FROM roldanerp.modulos m
 WHERE m.id = em.modulo_id
   AND m.slug = 'conversaciones-finalizadas'
   AND em.activo IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

-- ── Cómo quedó ──────────────────────────────────────────────────────────────
SELECT m.slug,
       m.nombre,
       count(em.id) FILTER (WHERE em.activo) AS empresas_con_el_modulo
  FROM roldanerp.modulos m
  LEFT JOIN roldanerp.empresa_modulos em ON em.modulo_id = m.id
 WHERE m.slug = 'conversaciones-finalizadas'
 GROUP BY m.slug, m.nombre;
