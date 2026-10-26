-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 18 · Punto 1.3 · Stock crítico configurable por rubro
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Hoy Reposición usa un solo número para toda la empresa: "quiero stock para
--   N días". Eso trata igual a un tornillo que al proveedor le lleva dos días
--   traer y a una chapa que tarda quince. El resultado es que o sobra stock de
--   lo que llega rápido, o falta de lo que tarda.
--
--   El pedido (1.3) es definir la cobertura de stock crítico POR RUBRO, en
--   días: 5 para uno, 15 para otro.
--
-- QUÉ ES `dias_critico`
--   Los días de stock por debajo de los cuales el rubro se marca CRÍTICO.
--   En la práctica es el tiempo que tarda reponer: si la chapa tarda 15 días,
--   bajar de 15 días de stock significa que se va a cortar antes de que
--   llegue la próxima compra.
--
--   NULL significa "sin configurar": ese rubro sigue usando el umbral general
--   de la pantalla. No se pone un default numérico a propósito — un 10 puesto
--   por el sistema se confunde con un 10 puesto por alguien que lo pensó.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.categorias_productos') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.categorias_productos`.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.categorias_productos
  ADD COLUMN IF NOT EXISTS dias_critico integer NULL;

-- Un umbral de 0 días no quiere decir nada (todo estaría siempre bien), y más
-- de un año tampoco. El CHECK evita que un dedazo deje un rubro mal marcado
-- para siempre sin que nadie se entere.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'categorias_productos_dias_critico_chk'
       AND conrelid = 'roldanerp.categorias_productos'::regclass
  ) THEN
    ALTER TABLE roldanerp.categorias_productos
      ADD CONSTRAINT categorias_productos_dias_critico_chk
      CHECK (dias_critico IS NULL OR (dias_critico >= 1 AND dias_critico <= 365));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.categorias_productos.dias_critico IS
  'Punto 1.3. Dias de stock por debajo de los cuales el rubro se marca critico; en la practica, lo que tarda reponerlo. NULL = usa el umbral general de Reposicion.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp'
       AND table_name = 'categorias_productos'
       AND column_name = 'dias_critico'
  ) THEN
    RAISE EXCEPTION 'No se creo categorias_productos.dias_critico';
  END IF;
  RAISE NOTICE '1.3 listo: categorias_productos.dias_critico creada.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
