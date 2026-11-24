-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 105 · Quién puede operar cada caja
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: la caja es de quien la abre y de los administradores.
--   Los demás la ven, pero no le cargan movimientos, no cobran ventas en ella
--   ni la cierran. Si la abre un administrador, elige quién puede operarla.
--
-- QUÉ HACE
--   Agrega roldanerp.cajas.responsables (uuid[]): los usuarios que pueden
--   operar la caja, además de los administradores.
--     null  → caja abierta antes de este script: la opera cualquiera, como hasta hoy.
--
-- No cambia ninguna caja existente. Idempotente.
-- ============================================================================

ALTER TABLE roldanerp.cajas
  ADD COLUMN IF NOT EXISTS responsables uuid[];

COMMENT ON COLUMN roldanerp.cajas.responsables IS
  'Usuarios que pueden operar la caja (además de los administradores). null = sin restricción (cajas de antes del script 105).';

NOTIFY pgrst, 'reload schema';
