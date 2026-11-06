-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 78 · Con qué se le pagó al proveedor
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "la parte de los pagos a proveedores debe afectar a flujo de caja,
--    siempre que vaya en verde… y para pagar con transferencia que salga para
--    elegir el banco."
--
-- ── POR QUÉ UNA COLUMNA Y NO OTRA TABLA ────────────────────────────────────
--   La tabla se llama `cheques`, pero lo que guarda es EL PAGO a un proveedor:
--   a quién, cuánto, con qué banco, qué facturas cubre, y su recibo. El cheque
--   era el único medio que la pantalla sabía armar, y por eso quedó ese
--   nombre.
--
--   El flujo de caja se arma leyendo esta tabla. Entonces un pago por
--   transferencia que no se escriba acá NO EXISTE para el flujo: la plata sale
--   del banco y la planilla no se entera. Ese es el agujero que se cierra.
--
--   Armar una tabla aparte para las transferencias obligaría a leer las dos y
--   sumarlas en cada pantalla, y la primera que se olvidara de la segunda
--   volvería a mostrar un flujo incompleto. Una columna que diga con qué se
--   pagó alcanza.
--
-- ── EL VERDE ───────────────────────────────────────────────────────────────
--   En la planilla, verde = "emitido, sin cobrar": la plata está comprometida
--   y todavía no salió. Ese es el estado que suma al flujo. El cheque cobrado
--   pasa a ámbar y deja de sumar, porque ya salió del banco.
--
--   Una transferencia nace comprometida —se hace y listo—, así que entra en
--   verde el día que se hace.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.cheques') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.cheques.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.cheques
  ADD COLUMN IF NOT EXISTS medio text NOT NULL DEFAULT 'cheque';

-- El CHECK se agrega solo si no está. Si ya existe uno, se deja: puede haber
-- sido ampliado a mano y reescribirlo borraría esa decisión.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'roldanerp.cheques'::regclass
       AND conname  = 'cheques_medio_chk'
  ) THEN
    ALTER TABLE roldanerp.cheques
      ADD CONSTRAINT cheques_medio_chk
      CHECK (medio IN ('cheque', 'transferencia', 'efectivo', 'deposito'));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.cheques.medio IS
  'Con qué se le pagó al proveedor. La tabla se llama cheques por historia, '
  'pero guarda el pago: el cheque era el único medio que la pantalla sabía '
  'armar. El flujo de caja lee esta tabla, así que un pago que no esté acá no '
  'existe para la planilla.';

-- Lo que ya estaba es cheque: hasta ahora no se podía armar otra cosa.
UPDATE roldanerp.cheques SET medio = 'cheque' WHERE medio IS NULL;

CREATE INDEX IF NOT EXISTS idx_cheques_medio
  ON roldanerp.cheques (empresa_id, medio);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  medio,
  count(*)                                      AS pagos,
  count(*) FILTER (WHERE estado = 'emitido')    AS en_verde,
  count(*) FILTER (WHERE estado = 'cobrado')    AS ya_cobrados,
  sum(importe)                                  AS total
FROM roldanerp.cheques
GROUP BY medio
ORDER BY medio;
