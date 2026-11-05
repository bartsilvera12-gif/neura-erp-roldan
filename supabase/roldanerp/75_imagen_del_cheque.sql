-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 75 · La foto del cheque
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Al armar un pago a proveedor, poder subir la imagen del cheque.
--
-- ── POR QUÉ NO SE USA EL RECIBO DEL SCRIPT 70 ──────────────────────────────
--   Son dos papeles distintos y de dos momentos distintos:
--     · el CHEQUE lo hace la empresa, al armar el pago;
--     · el RECIBO lo entrega el proveedor, cuando pasa a retirar.
--   Guardar los dos en el mismo lugar haría que uno pise al otro.
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
  ADD COLUMN IF NOT EXISTS imagen_storage_path text,
  ADD COLUMN IF NOT EXISTS imagen_nombre       text,
  ADD COLUMN IF NOT EXISTS imagen_mime_type    text,
  ADD COLUMN IF NOT EXISTS imagen_subido_at    timestamptz;

COMMENT ON COLUMN roldanerp.cheques.imagen_storage_path IS
  'Foto o escaneo del cheque emitido (bucket de comprobantes de compras, '
  'carpeta cheques). No es el recibo del proveedor: ese va en recibo_storage_path.';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                   AS cheques,
  count(imagen_storage_path) AS con_foto_del_cheque,
  count(recibo_storage_path) AS con_recibo_del_proveedor
FROM roldanerp.cheques;
