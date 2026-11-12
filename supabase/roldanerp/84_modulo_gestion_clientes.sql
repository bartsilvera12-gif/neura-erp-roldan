-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 84 · Dar de alta y habilitar el módulo "Gestión Clientes"
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Le agregás el módulo de gestión de clientes."
--
-- ── POR QUÉ NO ALCANZABA CON ACTIVARLO ─────────────────────────────────────
--   La pantalla ya estaba construida y las tablas que usa ya existían, pero
--   el módulo NO ESTABA EN EL CATÁLOGO: `modulos` no tenía ninguna fila con
--   slug 'gestion-clientes'. Sin esa fila no hay qué activar, porque
--   `empresa_modulos` apunta a un módulo por su id.
--
--   Así que este script hace las dos cosas: lo da de alta en el catálogo y lo
--   habilita para la empresa.
--
-- ── QUÉ ES ESA PANTALLA ────────────────────────────────────────────────────
--   La cuenta de cada cliente vista desde la facturación: sus facturas, el
--   saldo, el estado de cada una y el cobro, más el historial y la
--   tipificación. Trae además el cambio de plan, que sirve a quien factura un
--   servicio mensual; para la venta de mostrador esa parte no se usa.
--
-- ── A QUIÉN LE APARECE ─────────────────────────────────────────────────────
--   A los administradores, que ven todos los módulos activos de la empresa.
--   Al resto NO, hasta que se le tilde en su ficha de usuario. Se hace así a
--   propósito: la pantalla muestra la deuda de los clientes, y quién puede
--   verla es una decisión de la casa, no algo que deba salir de un script.
--
-- ── SE PUEDE DESHACER ──────────────────────────────────────────────────────
--   UPDATE roldanerp.empresa_modulos SET activo = false
--    WHERE modulo_id = (SELECT id FROM roldanerp.modulos WHERE slug = 'gestion-clientes');
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
SELECT 'gestion-clientes',
       'Gestión Clientes',
       'La cuenta de cada cliente desde la facturación: sus facturas, el saldo, el estado de cada una y el cobro, con el historial y la tipificación.'
 WHERE NOT EXISTS (SELECT 1 FROM roldanerp.modulos WHERE slug = 'gestion-clientes');

-- 2) Habilitado para la empresa. Si ya tenía fila, se reactiva.
INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
  FROM roldanerp.empresas e
  CROSS JOIN roldanerp.modulos m
 WHERE m.slug = 'gestion-clientes'
   AND NOT EXISTS (
     SELECT 1 FROM roldanerp.empresa_modulos em
      WHERE em.empresa_id = e.id AND em.modulo_id = m.id);

UPDATE roldanerp.empresa_modulos em
   SET activo = true
  FROM roldanerp.modulos m
 WHERE m.id = em.modulo_id
   AND m.slug = 'gestion-clientes'
   AND em.activo IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

-- ── Cómo quedó ──────────────────────────────────────────────────────────────
SELECT m.slug,
       m.nombre,
       count(em.id) FILTER (WHERE em.activo) AS empresas_con_el_modulo
  FROM roldanerp.modulos m
  LEFT JOIN roldanerp.empresa_modulos em ON em.modulo_id = m.id
 WHERE m.slug = 'gestion-clientes'
 GROUP BY m.slug, m.nombre;
