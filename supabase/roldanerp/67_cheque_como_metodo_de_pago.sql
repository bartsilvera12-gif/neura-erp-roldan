-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 67 · Cheque como método de pago de una compra
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Poner que la compra se pueda pagar de caja y el método que sea cheque
--   también."
--
-- ── POR QUÉ HACE FALTA UN SCRIPT ───────────────────────────────────────────
--   El código ya acepta los cuatro medios (efectivo, transferencia, tarjeta,
--   cheque). Pero el esquema vino clonado de otra empresa, y esta base ya nos
--   mordió dos veces con restricciones CHECK que no contemplaban valores que
--   el código sí escribe: 'devolucion_venta' en movimientos_inventario (el
--   módulo de devoluciones nunca pudo cerrar una) y los orígenes de
--   transferencia.
--
--   Si `compras.metodo_pago` tiene un CHECK heredado sin 'cheque', el primer
--   pago con cheque revienta en la cara del usuario, al confirmar.
--
--   `caja_movimientos.medio_pago` NO hace falta tocarlo: el script 09 ya lo
--   dejó con 'cheque' adentro.
--
-- ── QUÉ HACE ───────────────────────────────────────────────────────────────
--   Busca un CHECK sobre `compras.metodo_pago`:
--     · Si no hay ninguno, no hace nada (la columna es texto libre).
--     · Si hay uno y ya incluye 'cheque', no hace nada.
--     · Si hay uno y NO lo incluye, lo EXTIENDE.
--
--   Extiende, no reescribe. Reescribir con la lista que uno cree completa
--   borra los valores que haya agregado otro script.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.compras') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.compras. Correr antes el script 01.';
  END IF;
END
$guard$;

DO $cheque$
DECLARE
  r      record;
  nombre text;
  defn   text;
BEGIN
  SELECT con.conname, pg_get_constraintdef(con.oid)
    INTO nombre, defn
    FROM pg_constraint con
    JOIN pg_class    cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
   WHERE nsp.nspname = 'roldanerp'
     AND cls.relname = 'compras'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%metodo_pago%'
   LIMIT 1;

  IF nombre IS NULL THEN
    RAISE NOTICE 'No hay CHECK sobre compras.metodo_pago: el cheque entra sin tocar nada.';
    RETURN;
  END IF;

  -- Se busca el valor PELADO, no entrecomillado: según cómo esté escrita la
  -- restricción, el valor puede aparecer como 'cheque' o suelto dentro de un
  -- '{a,b,c}'::text[]. Buscar con comillas fue exactamente el error que hizo
  -- que el script 61 no fuera idempotente.
  IF defn ILIKE '%cheque%' THEN
    RAISE NOTICE 'El CHECK % ya acepta cheque. No se toca.', nombre;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE roldanerp.compras DROP CONSTRAINT %I', nombre);
  EXECUTE format(
    'ALTER TABLE roldanerp.compras ADD CONSTRAINT %I CHECK ((%s) OR metodo_pago = ''cheque'')',
    nombre,
    -- `defn` viene como 'CHECK ((...))': se le saca el envoltorio para poder
    -- meter la condición vieja adentro de la nueva.
    regexp_replace(defn, '^CHECK\s*\((.*)\)$', '\1')
  );
  RAISE NOTICE 'CHECK % extendido: ahora acepta cheque.', nombre;
END
$cheque$;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT con.conname                      AS restriccion,
       pg_get_constraintdef(con.oid)    AS definicion,
       pg_get_constraintdef(con.oid) ILIKE '%cheque%' AS acepta_cheque
FROM pg_constraint con
JOIN pg_class     cls ON cls.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
WHERE nsp.nspname = 'roldanerp'
  AND cls.relname IN ('compras', 'caja_movimientos')
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%pago%'
ORDER BY cls.relname, con.conname;
