-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 31 · El módulo de transferencias se llamaba igual que el de reposición
-- ============================================================================
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────
--   En el menú aparecían dos entradas llamadas "Reposición", y son cosas
--   distintas:
--
--     · Inventario → Reposición  (/inventario/sugerencias)
--       Calcula cuánto se consumió, cuánto queda y cuánto conviene COMPRAR.
--
--     · Reposición               (/inventario/reposicion)
--       Mueve mercadería de una sucursal a otra, con número de remisión.
--       Esto es una TRANSFERENCIA, no una reposición.
--
--   Con el mismo nombre en las dos había que entrar para saber cuál era cuál.
--   El nombre que se ve en el menú ya se corrigió en el código; acá se corrige
--   el que está guardado en la base, que es el que se ve en la pantalla de
--   módulos de Configuración.
--
-- ── EL `slug` NO SE TOCA ──────────────────────────────────────────────────
--   Sigue siendo `reposicion`. El slug es la llave con la que el menú y las
--   rutas piden permiso: cambiarlo dejaría huérfana la fila de
--   `empresa_modulos` que ya está activa y el módulo desaparecería del menú
--   hasta volver a activarlo. Lo que se ve es el `nombre`; el slug es interno.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.modulos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.modulos. Correr antes el script 01.';
  END IF;
END
$guard$;

UPDATE roldanerp.modulos
   SET nombre = 'Transferencias entre sucursales',
       descripcion = 'Movimiento de mercadería entre sucursales, con número de remisión único.'
 WHERE slug = 'reposicion'
   AND nombre IS DISTINCT FROM 'Transferencias entre sucursales';

DO $verif$
DECLARE
  v_nombre text;
BEGIN
  SELECT nombre INTO v_nombre FROM roldanerp.modulos WHERE slug = 'reposicion';
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'No existe el modulo con slug "reposicion". Correr antes el script 30.';
  END IF;
  IF v_nombre <> 'Transferencias entre sucursales' THEN
    RAISE EXCEPTION 'El nombre quedo en "%"', v_nombre;
  END IF;
  RAISE NOTICE 'Listo: el modulo "reposicion" ahora se llama Transferencias entre sucursales.';
  RAISE NOTICE 'Cerra sesion y volve a entrar: el menu guarda los permisos en el navegador.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
