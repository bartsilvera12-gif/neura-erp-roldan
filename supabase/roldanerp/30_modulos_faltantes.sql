-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 30 · Módulos que faltan en el menú
-- ============================================================================
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────
--   Presupuestos y Transferencias entre sucursales no aparecen en el menú, y
--   si se escribe la dirección a mano la pantalla tampoco abre. No es que
--   falte el código: está completo y probado. Lo que falta es el permiso.
--
--   El menú no decide por su cuenta qué mostrar: pregunta por el `slug` de
--   cada módulo contra `empresa_modulos`. Un slug que no existe en el catálogo
--   `modulos` no se puede activar para nadie, así que la entrada queda oculta
--   y la ruta bloqueada. El catálogo de este esquema tiene 15 módulos y entre
--   ellos no están `presupuestos`, `reposicion` ni `comisiones`.
--
--   Por eso aparecían "vacíos" módulos enteros del pedido:
--     · presupuestos → módulo 9 completo (4 puntos)
--     · reposicion   → transferencias entre sucursales, punto 8.1
--     · comisiones   → módulo 4 completo (6 puntos)
--
--   Se agregan también `usuarios` y `configuracion`: sin el primero no se
--   puede poner el tope de descuento del punto 2.3, y sin el segundo no se
--   llega a configurar las comisiones del punto 4.5.
--
-- ── QUÉ NO SE AGREGA, Y POR QUÉ ───────────────────────────────────────────
--   `productos-a-vencer` queda afuera a propósito: es para mercadería con
--   fecha de vencimiento y en una ferretería no aplica. Si algún día venden
--   algo con vencimiento, se agrega igual que estos.
--
--   Tampoco se tocan los módulos heredados que esta instancia no usa
--   (omnicanal, CRM, marketing, sorteos, recetas): activarlos llenaría el
--   menú de pantallas que no corresponden a este negocio.
--
-- ── SOBRE EL ROL ──────────────────────────────────────────────────────────
--   El usuario administrador de la empresa NO ve todo por ser administrador:
--   solo un `super_admin` saltea estos permisos. Por eso hace falta activar
--   los módulos aunque se entre como admin.
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
-- 1) Registrar los módulos que faltan en el catálogo
-- ---------------------------------------------------------------------------
INSERT INTO roldanerp.modulos (nombre, slug, descripcion)
SELECT v.nombre, v.slug, v.descripcion
  FROM (VALUES
    ('Presupuestos',  'presupuestos',  'Cotizaciones comerciales. No afectan stock hasta convertirse en venta.'),
    ('Reposición',    'reposicion',    'Transferencias de mercadería entre sucursales, con número de remisión.'),
    ('Comisiones',    'comisiones',    'Cartera por vendedor y liquidación de comisiones por rentabilidad.'),
    ('Usuarios',      'usuarios',      'Altas, roles y tope de descuento por usuario.'),
    ('Configuración', 'configuracion', 'Parámetros del sistema: comisiones, rubros, sucursales y catálogos.')
  ) AS v(nombre, slug, descripcion)
 WHERE NOT EXISTS (
   SELECT 1 FROM roldanerp.modulos m WHERE m.slug = v.slug
 );

-- ---------------------------------------------------------------------------
-- 2) Activarlos para la empresa
-- ---------------------------------------------------------------------------
--   Se activan para TODAS las empresas del esquema. En esta instancia hay una
--   sola; escribirlo así evita tener que pegar un uuid a mano, que es de
--   donde salen los errores difíciles de encontrar.
--
--   Si la fila ya existe pero está en `activo = false`, se reactiva: esa es la
--   otra forma en que un módulo desaparece del menú.
WITH nuevos AS (
  SELECT m.id AS modulo_id, e.id AS empresa_id
    FROM roldanerp.modulos m
    CROSS JOIN roldanerp.empresas e
   WHERE m.slug IN ('presupuestos', 'reposicion', 'comisiones', 'usuarios', 'configuracion')
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
   AND m.slug IN ('presupuestos', 'reposicion', 'comisiones', 'usuarios', 'configuracion')
   AND em.activo IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- 3) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_faltan text;
  v_inactivos text;
BEGIN
  SELECT string_agg(s.slug, ', ') INTO v_faltan
    FROM (VALUES ('presupuestos'),('reposicion'),('comisiones'),('usuarios'),('configuracion')) AS s(slug)
   WHERE NOT EXISTS (SELECT 1 FROM roldanerp.modulos m WHERE m.slug = s.slug);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'No quedaron registrados en el catalogo: %', v_faltan;
  END IF;

  SELECT string_agg(DISTINCT m.slug, ', ') INTO v_inactivos
    FROM roldanerp.modulos m
    JOIN roldanerp.empresa_modulos em ON em.modulo_id = m.id
   WHERE m.slug IN ('presupuestos','reposicion','comisiones','usuarios','configuracion')
     AND em.activo IS DISTINCT FROM true;
  IF v_inactivos IS NOT NULL THEN
    RAISE EXCEPTION 'Quedaron inactivos para alguna empresa: %', v_inactivos;
  END IF;

  RAISE NOTICE 'Listo: Presupuestos, Reposicion, Comisiones, Usuarios y Configuracion activos.';
  RAISE NOTICE 'Cerra sesion y volve a entrar: el menu guarda los permisos en el navegador.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
