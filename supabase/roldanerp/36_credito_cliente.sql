-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 36 · Plazo de crédito del cliente, y que el límite sirva para algo
-- ============================================================================
--
-- QUÉ FALTABA
--   `clientes.limite_credito` existía y se cargaba en la ficha, pero no lo
--   miraba nadie: se podía vender a crédito por encima del límite sin que el
--   sistema dijera una palabra. Un límite que no frena no es un límite, es un
--   comentario.
--
--   Y el plazo —a cuántos días se le fía a ese cliente— no estaba en ningún
--   lado: se escribía a mano en cada venta. El que atiende tiene que acordarse
--   de que a tal cliente son 30 días y a tal otro 15, y el día que se
--   equivoca la cuenta vence cuando no corresponde.
--
-- QUÉ AGREGA
--   `dias_credito`: el plazo que tiene acordado ese cliente. La venta a
--   crédito lo propone solo y no deja pasarse.
--
--   NULL significa "sin plazo acordado": no se propone nada y no se controla.
--   No es lo mismo que 0, que sería "no se le fía a días" — para eso está el
--   límite en 0.
--
-- EL LÍMITE SE CONTROLA EN EL SERVIDOR
--   Contra lo que el cliente ya debe: la suma de sus ventas a crédito sin
--   cobrar, más lo que se le está por vender. Mirarlo solo en la pantalla no
--   alcanza, por lo mismo que el tope de descuento.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.clientes') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.clientes`.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.clientes
  ADD COLUMN IF NOT EXISTS dias_credito integer NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'clientes_dias_credito_chk'
       AND conrelid = 'roldanerp.clientes'::regclass
  ) THEN
    ALTER TABLE roldanerp.clientes
      ADD CONSTRAINT clientes_dias_credito_chk
      CHECK (dias_credito IS NULL OR (dias_credito >= 0 AND dias_credito <= 365));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.clientes.dias_credito IS
  'Plazo de crédito acordado con este cliente, en días. NULL = sin plazo acordado (no se propone ni se controla). La venta a crédito lo usa como valor por omisión y como máximo.';

COMMENT ON COLUMN roldanerp.clientes.limite_credito IS
  'Cuánto puede deber este cliente, en guaraníes. NULL = sin límite. 0 = no se le vende a crédito. Se controla al registrar la venta contra el saldo pendiente.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'clientes'
       AND column_name = 'dias_credito'
  ) THEN
    RAISE EXCEPTION 'No se creo clientes.dias_credito';
  END IF;
  RAISE NOTICE 'Listo: clientes.dias_credito creada. Se carga en la ficha del cliente, al lado del limite.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
