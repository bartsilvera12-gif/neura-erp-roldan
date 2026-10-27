-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 34 · Tope de descuento por tipo de vendedor (completa el punto 2.3)
-- ============================================================================
--
-- POR QUÉ ESTE SCRIPT
--   El tope de descuento no estaba funcionando. Dos motivos, encadenados:
--
--   1. `usuarios.descuento_maximo_pct` no existe en la base. El script 21 la
--      crea, pero nunca se corrió. El código está escrito para no romperse si
--      la columna falta —devuelve "sin tope" y deja pasar la venta—, así que
--      el sistema no avisaba nada: simplemente no había límite.
--
--   2. El tope se configuraba por usuario, y el pedido real es por TIPO de
--      vendedor: "call center hasta 10%". Con quince vendedores de call
--      center había que cargar quince topes y acordarse de ponerlo cada vez
--      que entra alguien nuevo. El primero que se olvide vende sin techo.
--
--   Este script arregla las dos: vuelve a aplicar la columna del 21 (es
--   idempotente, no pisa nada si ya está) y agrega el tope al tipo.
--
-- CÓMO SE RESUELVE EL TOPE DE UNA PERSONA
--   1. Su propio `usuarios.descuento_maximo_pct`, si tiene uno cargado.
--   2. Si no, el de su tipo de vendedor.
--   3. Si tampoco, sin tope.
--
--   El valor del usuario gana sobre el del tipo a propósito: es la excepción
--   —el vendedor con más años al que se le da más margen— y una excepción que
--   no puede pasarle por encima a la regla general no sirve de nada.
--
-- NULL NO ES CERO
--   NULL = sin tope. 0 = no puede descontar nada, que es un valor real y
--   distinto. Por eso ninguna de las dos columnas tiene default numérico: con
--   un default no habría forma de distinguir "no configurado" de "tope 100%".
--
-- Requiere 01, 02 y 23 (tipos_vendedor) corridos. Solo escribe en `roldanerp`.
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.usuarios`.';
  END IF;
  IF to_regclass('roldanerp.tipos_vendedor') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.tipos_vendedor`. Corré antes el script de comisiones.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1 · La columna del script 21, por si ese script no se corrió
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.usuarios
  ADD COLUMN IF NOT EXISTS descuento_maximo_pct numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usuarios_descuento_maximo_chk'
       AND conrelid = 'roldanerp.usuarios'::regclass
  ) THEN
    ALTER TABLE roldanerp.usuarios
      ADD CONSTRAINT usuarios_descuento_maximo_chk
      CHECK (descuento_maximo_pct IS NULL
             OR (descuento_maximo_pct >= 0 AND descuento_maximo_pct <= 100));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.usuarios.descuento_maximo_pct IS
  'Punto 2.3. Tope de descuento en % de esta persona. NULL = usa el de su tipo de vendedor. 0 = no puede descontar.';

-- ---------------------------------------------------------------------------
-- 2 · El tope por tipo de vendedor
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.tipos_vendedor
  ADD COLUMN IF NOT EXISTS descuento_maximo_pct numeric NULL;

DO $chk2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tipos_vendedor_descuento_maximo_chk'
       AND conrelid = 'roldanerp.tipos_vendedor'::regclass
  ) THEN
    ALTER TABLE roldanerp.tipos_vendedor
      ADD CONSTRAINT tipos_vendedor_descuento_maximo_chk
      CHECK (descuento_maximo_pct IS NULL
             OR (descuento_maximo_pct >= 0 AND descuento_maximo_pct <= 100));
  END IF;
END
$chk2$;

COMMENT ON COLUMN roldanerp.tipos_vendedor.descuento_maximo_pct IS
  'Tope de descuento en % para todos los vendedores de este tipo. NULL = sin tope. Lo pisa el tope cargado en la persona, si tiene uno.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  faltan text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'usuarios'
       AND column_name = 'descuento_maximo_pct'
  ) THEN faltan := faltan || 'usuarios.descuento_maximo_pct '; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'tipos_vendedor'
       AND column_name = 'descuento_maximo_pct'
  ) THEN faltan := faltan || 'tipos_vendedor.descuento_maximo_pct '; END IF;

  IF faltan <> '' THEN
    RAISE EXCEPTION 'No se crearon: %', faltan;
  END IF;

  RAISE NOTICE 'Listo. Las dos columnas existen y arrancan en NULL = sin tope.';
  RAISE NOTICE 'Cargá el tope en Comisiones → Configuración → Tipos de vendedor, y las excepciones en Configuración → RRHH → Usuarios.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
