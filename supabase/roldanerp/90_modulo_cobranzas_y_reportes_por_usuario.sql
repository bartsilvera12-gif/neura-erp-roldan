-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 90 · Módulo Cobranzas aparte, y qué reportes ve cada usuario
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   1) Sacar las cobranzas de Pagos y ponerlas en un módulo aparte, con su
--      reporte. Pagos queda para lo que se le paga a los proveedores.
--   2) Poder elegir exactamente qué reportes ve cada usuario.
--
-- ── 1) MÓDULO COBRANZAS ────────────────────────────────────────────────────
--   Se crea el módulo y se habilita para la empresa. A cada usuario que hoy
--   tiene Pagos asignado se le asigna también Cobranzas: nadie que hoy cobra
--   pierde la pantalla por el cambio. Después se le puede sacar a quien no
--   corresponda.
--
-- ── 2) REPORTES POR USUARIO ────────────────────────────────────────────────
--   `usuarios.reportes_permitidos`: la lista de reportes que ve. NULL o vacía
--   = ninguno (decisión del cliente: los usuarios existentes no ven reportes
--   hasta que un administrador se los asigne). La administración ve todos
--   siempre.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.modulos') IS NULL OR to_regclass('roldanerp.empresa_modulos') IS NULL THEN
    RAISE EXCEPTION 'Faltan roldanerp.modulos / roldanerp.empresa_modulos.';
  END IF;
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.usuarios.';
  END IF;
END
$guard$;

-- ── 1) Cobranzas ────────────────────────────────────────────────────────────
INSERT INTO roldanerp.modulos (slug, nombre, descripcion)
SELECT 'cobranzas',
       'Cobranzas',
       'Lo que deben los clientes de las ventas a crédito, el registro de cada cobro y el reporte de cobranzas.'
 WHERE NOT EXISTS (SELECT 1 FROM roldanerp.modulos WHERE slug = 'cobranzas');

INSERT INTO roldanerp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
  FROM roldanerp.empresas e
  CROSS JOIN roldanerp.modulos m
 WHERE m.slug = 'cobranzas'
   AND NOT EXISTS (
     SELECT 1 FROM roldanerp.empresa_modulos em
      WHERE em.empresa_id = e.id AND em.modulo_id = m.id);

UPDATE roldanerp.empresa_modulos em
   SET activo = true
  FROM roldanerp.modulos m
 WHERE m.id = em.modulo_id
   AND m.slug = 'cobranzas'
   AND em.activo IS DISTINCT FROM true;

-- Quien tiene Pagos asignado, también Cobranzas.
DO $copia$
BEGIN
  IF to_regclass('roldanerp.usuario_modulos') IS NOT NULL THEN
    INSERT INTO roldanerp.usuario_modulos (usuario_id, modulo_id)
    SELECT um.usuario_id, mc.id
      FROM roldanerp.usuario_modulos um
      JOIN roldanerp.modulos mp ON mp.id = um.modulo_id AND mp.slug = 'pagos'
      CROSS JOIN roldanerp.modulos mc
     WHERE mc.slug = 'cobranzas'
       AND NOT EXISTS (
         SELECT 1 FROM roldanerp.usuario_modulos x
          WHERE x.usuario_id = um.usuario_id AND x.modulo_id = mc.id);
  END IF;
END
$copia$;

-- ── 2) Reportes por usuario ─────────────────────────────────────────────────
ALTER TABLE roldanerp.usuarios
  ADD COLUMN IF NOT EXISTS reportes_permitidos text[];

COMMENT ON COLUMN roldanerp.usuarios.reportes_permitidos IS
  'Reportes que ve este usuario (claves: ventas, ganancias, rentabilidad…). '
  'NULL o vacía = ninguno. La administración ve todos siempre.';

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM roldanerp.empresa_modulos em JOIN roldanerp.modulos m ON m.id = em.modulo_id
    WHERE m.slug = 'cobranzas' AND em.activo)                                   AS empresas_con_cobranzas,
  (SELECT count(*) FROM roldanerp.usuario_modulos um JOIN roldanerp.modulos m ON m.id = um.modulo_id
    WHERE m.slug = 'cobranzas')                                                 AS usuarios_con_cobranzas,
  (SELECT count(*) FROM roldanerp.usuarios WHERE reportes_permitidos IS NOT NULL) AS usuarios_con_reportes;
