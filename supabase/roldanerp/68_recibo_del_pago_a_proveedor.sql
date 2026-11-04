-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 68 · El recibo del pago a proveedor
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Cargar el recibo del pago a proveedor en la parte de pagos."
--
-- ── POR QUÉ NO ALCANZA CON LO QUE YA HAY ───────────────────────────────────
--   `compras` ya guarda un comprobante: `comprobante_storage_path` y sus dos
--   acompañantes. Pero ese es la FACTURA DEL PROVEEDOR — el papel que llega
--   con la mercadería. El recibo es otro documento y de otro momento: es el
--   que el proveedor firma cuando cobra, y es el que se busca cuando alguien
--   pregunta si una factura se pagó de verdad.
--
--   Guardar los dos en el mismo campo haría que subir el recibo borre la
--   factura, que es exactamente el tipo de pérdida que nadie nota hasta que
--   la necesita.
--
-- ── POR QUÉ NO VA EN caja_movimientos ──────────────────────────────────────
--   El egreso de caja ya tiene `adjuntos`, y si el pago salió por caja el
--   recibo podría ir ahí. Pero un pago puede registrarse sin turno de caja
--   abierto: la compra queda pagada y no hay ningún movimiento al que colgarle
--   el papel. El recibo pertenece a la COMPRA, que siempre existe.
--
-- ── OJO CON EL ORDEN ───────────────────────────────────────────────────────
--   El código desplegado pide estas columnas. Mientras este script no corra,
--   PostgREST rechaza la consulta ENTERA con 42703 —no devuelve la fila sin la
--   columna, devuelve un error— así que la pantalla de Pagos se vería vacía.
--   Por eso el código las pide con reintento sin ellas; igual conviene correr
--   esto cuanto antes.
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

ALTER TABLE roldanerp.compras
  ADD COLUMN IF NOT EXISTS recibo_storage_path text,
  ADD COLUMN IF NOT EXISTS recibo_nombre       text,
  ADD COLUMN IF NOT EXISTS recibo_mime_type    text,
  ADD COLUMN IF NOT EXISTS recibo_subido_at    timestamptz;

COMMENT ON COLUMN roldanerp.compras.recibo_storage_path IS
  'Recibo del PAGO al proveedor, en el bucket privado de comprobantes. Es un '
  'documento distinto de comprobante_storage_path, que es la factura que el '
  'proveedor emitió con la mercadería.';

COMMENT ON COLUMN roldanerp.compras.recibo_subido_at IS
  'Cuándo se cargó el recibo. Sirve para distinguir un pago sin respaldo de '
  'uno al que todavía no le subieron el papel.';

-- Una compra son VARIAS filas (una por ítem) con el mismo numero_control, y el
-- recibo es uno solo para toda la compra: se escribe en todas sus filas. Este
-- índice es para poder buscarlas rápido al escribir.
CREATE INDEX IF NOT EXISTS idx_compras_numero_control_empresa
  ON roldanerp.compras (empresa_id, numero_control);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(DISTINCT numero_control) FILTER (WHERE estado = 'pagada')              AS compras_pagadas,
  count(DISTINCT numero_control) FILTER (WHERE recibo_storage_path IS NOT NULL) AS con_recibo,
  count(DISTINCT numero_control) FILTER (
    WHERE estado = 'pagada' AND recibo_storage_path IS NULL
  )                                                                            AS pagadas_sin_recibo
FROM roldanerp.compras;
