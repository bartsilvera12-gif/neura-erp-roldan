-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 91 · Dirección y teléfono de cada sucursal en los documentos
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Que los documentos de la sucursal de Carapeguá salgan con la dirección de
--   Carapeguá, no con la de la casa central.
--
--   Hasta ahora el membrete tenía una sola dirección para todos. Con esto
--   cada sucursal guarda la suya (Configuración → Sucursales) y los
--   documentos que se emiten ahí la usan. Sin dirección cargada, sale la de
--   siempre.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.sucursales') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.sucursales.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.sucursales
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS telefono  text;

COMMENT ON COLUMN roldanerp.sucursales.direccion IS
  'Dirección que sale en el membrete de los documentos de esta sucursal. NULL = la de la casa central.';
COMMENT ON COLUMN roldanerp.sucursales.telefono IS
  'Teléfono que sale en el membrete de los documentos de esta sucursal. NULL = el de la casa central.';

-- Carapeguá, con los datos de su papelería. Solo si todavía no tiene nada
-- cargado: si alguien ya la editó desde Configuración, no se pisa.
UPDATE roldanerp.sucursales
   SET direccion = 'Ruta 1 Mcal. Francisco Solano López Km. 84 - Carapeguá, Paraguay',
       telefono  = '(0218) 213 082 - Cel.: (0982) 255 487'
 WHERE translate(lower(nombre), 'áéíóú', 'aeiou') LIKE '%carapegu%'
   AND direccion IS NULL
   AND telefono IS NULL;

NOTIFY pgrst, 'reload schema';

SELECT nombre, direccion, telefono FROM roldanerp.sucursales ORDER BY nombre;
