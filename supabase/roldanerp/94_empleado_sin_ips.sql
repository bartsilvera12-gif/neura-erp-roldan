-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 94 · Empleado que no aporta al IPS
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Un botón en la ficha del empleado para marcar que no usa IPS: el
--   facturador (que factura sus servicios) y quien no aporta por otro motivo.
--
--   El facturador ya se marca con el tipo de contrato. Esta columna es para el
--   otro caso: alguien en relación de dependencia que no está en el IPS. Si
--   no aporta, su recibo sale sin el 9% del trabajador ni el aporte patronal.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

ALTER TABLE roldanerp.empleados
  ADD COLUMN IF NOT EXISTS aporta_ips boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN roldanerp.empleados.aporta_ips IS
  'false = no aporta al IPS (su recibo sale sin el 9% ni el aporte patronal). '
  'El facturador tampoco aporta, aunque esto quede en true: lo dice su tipo de contrato.';

NOTIFY pgrst, 'reload schema';

SELECT count(*) FILTER (WHERE NOT aporta_ips) AS sin_ips, count(*) AS empleados FROM roldanerp.empleados;
