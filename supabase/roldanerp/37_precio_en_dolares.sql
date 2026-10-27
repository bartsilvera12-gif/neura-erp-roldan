-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 37 · Precio de venta en dólares
-- ============================================================================
--
-- QUÉ RESUELVE
--   El dólar estaba solo en el COSTO: se cargaba el costo en US$ y el sistema
--   lo pasaba a guaraníes una vez, al guardar. El precio de venta se cargaba
--   en guaraníes y quedaba fijo.
--
--   El cliente trabaja al revés, y así funcionaba su sistema viejo: el precio
--   de lista está en dólares, y los guaraníes salen de multiplicar por la
--   cotización. Cuando el dólar se mueve, los precios acompañan sin que nadie
--   tenga que recorrer el catálogo a mano.
--
-- CÓMO CONVIVEN LAS DOS FORMAS
--   `precio_usd` NULL  → el producto se vende en guaraníes. Manda
--                        `precio_venta`, como hasta ahora.
--   `precio_usd` cargado → el producto se vende en dólares. El precio en
--                        guaraníes se calcula en el momento de vender, con la
--                        cotización de venta del día.
--
--   Es por producto a propósito: en el mismo catálogo hay cosas importadas,
--   que se piensan en dólares, y cosas locales que no. Obligar a todo el
--   catálogo a una sola moneda haría que una de las dos mitades mienta.
--
-- POR QUÉ `precio_venta` SE SIGUE ESCRIBIENDO
--   Al guardar un producto en dólares también se guarda su equivalente en
--   guaraníes del momento. No es la fuente de verdad —esa es `precio_usd`—
--   pero deja que todo lo que ya lee `precio_venta` (informes viejos,
--   exportaciones, el historial de precios) siga mostrando un número con
--   sentido en vez de un cero.
--
-- SIN REDONDEO
--   El precio es exactamente el dólar por la cotización, redondeado al guaraní
--   entero porque no existe la fracción. Es la decisión del cliente: que el
--   número sea fiel al dólar, aunque quede menos redondo en el mostrador.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.productos`.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.productos
  ADD COLUMN IF NOT EXISTS precio_usd numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'productos_precio_usd_chk'
       AND conrelid = 'roldanerp.productos'::regclass
  ) THEN
    ALTER TABLE roldanerp.productos
      ADD CONSTRAINT productos_precio_usd_chk
      CHECK (precio_usd IS NULL OR precio_usd > 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.productos.precio_usd IS
  'Precio de lista en dólares. NULL = el producto se vende en guaraníes y manda precio_venta. Cargado = el precio en guaraníes se calcula al vender, con la cotización de venta del día; precio_venta guarda el equivalente del último guardado.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'productos'
       AND column_name = 'precio_usd'
  ) THEN
    RAISE EXCEPTION 'No se creo productos.precio_usd';
  END IF;
  RAISE NOTICE 'Listo: productos.precio_usd creada. Todos los productos siguen en guaranies hasta que se les cargue un precio en dolares.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
