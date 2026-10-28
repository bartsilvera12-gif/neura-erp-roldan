-- ===========================================================================
-- 39 · Porcentaje por rubro de cliente
-- ---------------------------------------------------------------------------
-- Hoy el precio de un rubro de cliente (MAYORISTA, DISTRIBUIDOR, …) se carga
-- producto por producto en `precios_por_categoria`. Con un catálogo real eso
-- no se puede mantener: cada producto nuevo nace sin precio de mayorista, y
-- cambiar la política de mayoristas obliga a recorrer el catálogo entero.
--
-- La política es un porcentaje, no una lista de precios: "al mayorista le
-- hacemos 8% menos". Entonces se guarda el porcentaje una vez por rubro y se
-- aplica sobre el precio de lista de cualquier producto, incluidos los que
-- todavía no existen.
--
-- `precios_por_categoria` NO se borra ni se vacía: pasa a ser la excepción.
-- Si un producto tiene precio cargado para ese rubro, ese precio gana sobre
-- el porcentaje (hay productos con precio negociado que no siguen la regla).
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF to_regclass('roldanerp.categorias_cliente') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.categorias_cliente. Corré antes 23_clientes_modulo3.sql.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- El porcentaje del rubro
-- ---------------------------------------------------------------------------
-- Signo: NEGATIVO baja el precio, POSITIVO lo sube.
--   MAYORISTA    = -8   → 8% menos que el precio de lista
--   DISTRIBUIDOR = -15
--   OCASIONAL    =  0   (o NULL: lo mismo, paga lista)
-- NULL significa "sin política definida": paga el precio de lista.
ALTER TABLE roldanerp.categorias_cliente
  ADD COLUMN IF NOT EXISTS ajuste_pct numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'categorias_cliente_ajuste_pct_chk'
       AND conrelid = 'roldanerp.categorias_cliente'::regclass
  ) THEN
    -- Un ajuste de -100 regalaría el producto y uno de +1000 es un error de
    -- tipeo, no una política. Se encierra en un rango que un humano pueda
    -- defender frente al cliente.
    ALTER TABLE roldanerp.categorias_cliente
      ADD CONSTRAINT categorias_cliente_ajuste_pct_chk
      CHECK (ajuste_pct IS NULL OR (ajuste_pct > -100 AND ajuste_pct <= 100));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.categorias_cliente.ajuste_pct IS
  'Ajuste porcentual sobre el precio de lista para los clientes de este rubro. '
  'Negativo baja el precio (MAYORISTA -8 = 8% menos), positivo lo sube. '
  'NULL o 0 = paga precio de lista. Un precio cargado en precios_por_categoria '
  'para un producto puntual gana sobre este porcentaje.';

-- ---------------------------------------------------------------------------
-- La tabla por producto queda, pero como excepción
-- ---------------------------------------------------------------------------
DO $doc$
BEGIN
  IF to_regclass('roldanerp.precios_por_categoria') IS NOT NULL THEN
    COMMENT ON TABLE roldanerp.precios_por_categoria IS
      'EXCEPCIONES de precio por rubro de cliente, producto por producto. '
      'La regla general es categorias_cliente.ajuste_pct; esta tabla solo se '
      'carga para los productos cuyo precio negociado no sigue esa regla.';
  END IF;
END
$doc$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  v_n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp'
       AND table_name   = 'categorias_cliente'
       AND column_name  = 'ajuste_pct'
  ) THEN
    RAISE EXCEPTION 'Falta la columna categorias_cliente.ajuste_pct';
  END IF;

  SELECT count(*) INTO v_n FROM roldanerp.categorias_cliente WHERE activa;
  RAISE NOTICE 'Script 39 listo: categorias_cliente.ajuste_pct creada. % rubros activos, todos en NULL (precio de lista) hasta que les cargues el porcentaje.', v_n;
END
$check$;

NOTIFY pgrst, 'reload schema';
