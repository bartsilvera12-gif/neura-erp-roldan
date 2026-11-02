-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 54 · Mínimo de ventas para cobrar la comisión entera
-- ============================================================================
--
-- ── QUÉ AGREGA ────────────────────────────────────────────────────────────
--   `minimo_ventas` en dos lugares:
--
--      tipos_vendedor.minimo_ventas  → el mínimo de todos los de ese tipo
--      usuarios.minimo_ventas        → el de esa persona, si tiene uno propio
--
--   El de la persona le gana al del tipo. NULL = no tiene uno propio y usa el
--   de su tipo; NULL en el tipo = sin mínimo, se cobra la comisión entera
--   siempre (que es como venía funcionando).
--
-- ── PARA QUÉ ──────────────────────────────────────────────────────────────
--   Si el vendedor llega a su mínimo de ventas del período, cobra el
--   porcentaje que tenga cargado. Si no llega, cobra la mitad.
--
--   El mínimo se mide contra lo FACTURADO sin IVA en el período del informe,
--   que es con lo que se comparan el resto de los números de esa pantalla.
--   Sin IVA porque el IVA no es del negocio: incluirlo haría que el mínimo se
--   alcance con un 10% menos de venta real.
--
-- ── EL RUBRO PADRE YA EXISTÍA ─────────────────────────────────────────────
--   `categorias_productos.parent_id` ya está en la base desde el principio, así
--   que las subcategorías no necesitan ninguna columna nueva: lo que faltaba
--   era que el cálculo de comisiones la mirara. Este script solo deja el índice
--   para que buscar los hijos de un rubro no recorra la tabla entera.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

ALTER TABLE roldanerp.tipos_vendedor
  ADD COLUMN IF NOT EXISTS minimo_ventas numeric NULL;

ALTER TABLE roldanerp.usuarios
  ADD COLUMN IF NOT EXISTS minimo_ventas numeric NULL;

-- Un mínimo negativo no significa nada; cero sí: "no tiene mínimo que superar".
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tipos_vendedor_minimo_chk'
       AND conrelid = 'roldanerp.tipos_vendedor'::regclass
  ) THEN
    ALTER TABLE roldanerp.tipos_vendedor
      ADD CONSTRAINT tipos_vendedor_minimo_chk
      CHECK (minimo_ventas IS NULL OR minimo_ventas >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usuarios_minimo_ventas_chk'
       AND conrelid = 'roldanerp.usuarios'::regclass
  ) THEN
    ALTER TABLE roldanerp.usuarios
      ADD CONSTRAINT usuarios_minimo_ventas_chk
      CHECK (minimo_ventas IS NULL OR minimo_ventas >= 0);
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.tipos_vendedor.minimo_ventas IS
  'Facturacion sin IVA que hay que alcanzar en el periodo para cobrar la comision entera. Por debajo se cobra la mitad. NULL = sin minimo.';
COMMENT ON COLUMN roldanerp.usuarios.minimo_ventas IS
  'Minimo propio de esta persona. Le gana al de su tipo. NULL = usa el del tipo.';

-- Buscar los hijos de un rubro, para que el porcentaje del padre alcance a sus
-- subcategorías.
CREATE INDEX IF NOT EXISTS categorias_productos_parent_idx
  ON roldanerp.categorias_productos (empresa_id, parent_id)
  WHERE parent_id IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_tv int; v_us int; v_idx int; v_hijos int;
BEGIN
  SELECT count(*) INTO v_tv FROM information_schema.columns
   WHERE table_schema = 'roldanerp' AND table_name = 'tipos_vendedor'
     AND column_name = 'minimo_ventas';
  SELECT count(*) INTO v_us FROM information_schema.columns
   WHERE table_schema = 'roldanerp' AND table_name = 'usuarios'
     AND column_name = 'minimo_ventas';
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'roldanerp' AND indexname = 'categorias_productos_parent_idx';

  IF v_tv <> 1 OR v_us <> 1 OR v_idx <> 1 THEN
    RAISE EXCEPTION 'Script 54 incompleto: tipos_vendedor=% usuarios=% indice=%', v_tv, v_us, v_idx;
  END IF;

  SELECT count(*) INTO v_hijos FROM roldanerp.categorias_productos WHERE parent_id IS NOT NULL;
  RAISE NOTICE 'Script 54 listo.';
  RAISE NOTICE '  Falta cargar los minimos en Comisiones -> Configuracion.';
  RAISE NOTICE '  Rubros con padre cargado: % (se arman en Inventario -> Rubros).', v_hijos;
END
$verif$;

NOTIFY pgrst, 'reload schema';
