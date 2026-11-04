-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 70 · El recibo del proveedor, atado al cheque
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Una orden de pago consolidada que junte varias facturas de un mismo
--   proveedor en UN cheque; el proveedor entrega un recibo con el número de
--   cheque, el monto, la fecha y el número de recibo; y todo eso tiene que
--   quedar cargado en el sistema.
--
-- ── POR QUÉ IMPORTA, EN PALABRAS DE JOAQUÍN ────────────────────────────────
--   "Hay proveedores que traspapelan los documentos, entonces te piden de
--   vuelta el cobro de esa factura como que vos estabas deudando."
--
--   O sea: esto no es prolijidad administrativa, es la prueba de que una
--   factura ya se pagó. Cuando el proveedor vuelve a reclamarla, lo que
--   termina la discusión es el número de recibo QUE ÉL emitió, con el número
--   de cheque y la fecha. Por eso los tres datos van juntos y el papel
--   escaneado al lado.
--
-- ── POR QUÉ VA EN EL CHEQUE Y NO EN LA COMPRA ──────────────────────────────
--   El script 68 puso el recibo en `compras`, y está bien para el pago suelto:
--   una compra, un pago, un recibo.
--
--   Pero un cheque consolidado cubre VARIAS facturas y el proveedor entrega UN
--   solo recibo por el total. Guardarlo en cada compra obligaría a subir el
--   mismo papel cinco veces, y peor: si después se corrige el número de
--   recibo, habría cinco copias y alguna quedaría vieja.
--
--   El dato pertenece al pago. Las facturas que ese pago cubre ya están atadas
--   por `cheque_compras`, así que desde cualquiera de ellas se llega al recibo.
--
-- ── LO QUE YA EXISTÍA ──────────────────────────────────────────────────────
--   `cheques` ya tiene `numero` (el del cheque), `importe` y `fecha_emision`.
--   Y `cheque_compras` ya permite que un cheque cubra varias facturas: el
--   modelo consolidado estaba, faltaba la pantalla para armarlo fuera de una
--   sola celda del flujo de caja, y faltaban estos campos.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.cheques') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.cheques.';
  END IF;
  IF to_regclass('roldanerp.cheque_compras') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.cheque_compras: sin ella un cheque no puede cubrir facturas.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.cheques
  -- El número que el PROVEEDOR puso en su recibo. No es el del cheque.
  ADD COLUMN IF NOT EXISTS numero_recibo       text,
  -- La fecha del recibo, que puede no ser la de emisión del cheque: el
  -- proveedor lo entrega cuando pasa a retirar.
  ADD COLUMN IF NOT EXISTS fecha_recibo        date,
  ADD COLUMN IF NOT EXISTS recibo_storage_path text,
  ADD COLUMN IF NOT EXISTS recibo_nombre       text,
  ADD COLUMN IF NOT EXISTS recibo_mime_type    text,
  ADD COLUMN IF NOT EXISTS recibo_subido_at    timestamptz;

COMMENT ON COLUMN roldanerp.cheques.numero_recibo IS
  'Número del recibo que emitió el PROVEEDOR al cobrar. Es la prueba de que '
  'las facturas de este cheque ya se pagaron: lo que se muestra cuando vuelven '
  'a reclamar una factura traspapelada.';

COMMENT ON COLUMN roldanerp.cheques.fecha_recibo IS
  'Fecha del recibo. Puede no coincidir con fecha_emision: el cheque se hace '
  'un día y el proveedor pasa a retirarlo otro.';

-- Buscar por número de recibo es JUSTO lo que se hace cuando el proveedor
-- reclama: "acá está, recibo 4821".
CREATE INDEX IF NOT EXISTS idx_cheques_numero_recibo
  ON roldanerp.cheques (empresa_id, numero_recibo)
  WHERE numero_recibo IS NOT NULL;

-- Para llegar rápido de una factura a su cheque, que es el otro lado de la
-- misma pregunta.
CREATE INDEX IF NOT EXISTS idx_cheque_compras_compra
  ON roldanerp.cheque_compras (empresa_id, compra_numero_control);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                                        AS cheques,
  count(numero)                                   AS con_numero_de_cheque,
  count(numero_recibo)                            AS con_recibo_del_proveedor,
  count(recibo_storage_path)                      AS con_papel_adjunto,
  (SELECT count(*) FROM roldanerp.cheque_compras) AS facturas_cubiertas
FROM roldanerp.cheques;
