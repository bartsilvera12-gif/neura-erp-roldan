-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 21 · Punto 2.3 · Descuento máximo por usuario
-- ============================================================================
--
-- QUÉ PIDE EL PUNTO
--   "Aplicar descuentos desde Caja con un máximo configurable para cada
--   usuario o vendedor."
--
-- QUÉ HAY HOY
--   En Caja se puede escribir cualquier descuento de 0 a 100%. El único freno
--   es que el precio no baje del costo, y eso no es un límite comercial: entre
--   vender al costo y vender con el margen acordado hay toda la ganancia del
--   negocio.
--
-- QUÉ SIGNIFICA `descuento_maximo_pct`
--   El tope, en porcentaje, que ese usuario puede descontar en una línea.
--
--   NULL = sin tope. Es el caso del dueño y de los administradores: no tiene
--   sentido que el sistema le ponga un techo a quien decide los precios.
--   0 = no puede descontar nada. Es un valor distinto y válido: el cajero
--   nuevo que cobra lo que dice la lista y nada más.
--
--   Por eso la columna admite NULL en vez de arrancar todos en 100: un default
--   numérico haría imposible distinguir "sin tope" de "tope del 100%", que
--   parecen lo mismo hasta que alguien quiere bajar el techo general.
--
-- EL TOPE SE VALIDA EN EL SERVIDOR, no solo en la pantalla. Esconder el campo
-- no impide mandar la venta con otro precio.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.usuarios`.';
  END IF;
END
$guard$;

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
  'Punto 2.3. Tope de descuento en % que este usuario puede aplicar en Caja. NULL = sin tope (admin). 0 = no puede descontar.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp'
       AND table_name = 'usuarios'
       AND column_name = 'descuento_maximo_pct'
  ) THEN
    RAISE EXCEPTION 'No se creo usuarios.descuento_maximo_pct';
  END IF;
  RAISE NOTICE '2.3 listo: usuarios.descuento_maximo_pct creada. Todos arrancan en NULL = sin tope; hay que configurarlos.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
