-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 86 · Presupuesto "reservado": aparta la mercadería hasta que lo quite un admin
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   Poder marcar un presupuesto como RESERVADO. Mientras lo esté, su
--   mercadería no se puede volver a cotizar: si hay 20 en stock y 10
--   reservados, en otro presupuesto solo se pueden usar 10.
--   Cualquiera puede reservar; solo un administrador puede quitar la reserva.
--
-- ── EN QUÉ SE DIFERENCIA DE LO QUE YA HABÍA ────────────────────────────────
--   Un presupuesto APROBADO ya reservaba solo, pero mientras estuviera
--   vigente (un día). Esta marca no vence: la reserva sigue hasta que un
--   administrador la quite, o hasta que el presupuesto se cobre (ahí el stock
--   se descuenta de verdad) o se rechace.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.presupuestos.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS reservado       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservado_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reservado_por   text;

COMMENT ON COLUMN roldanerp.presupuestos.reservado IS
  'true = su mercadería está apartada y no se puede cotizar en otro '
  'presupuesto. La pone cualquiera; la quita solo un administrador. Deja de '
  'reservar al cobrarse o rechazarse el presupuesto.';

CREATE INDEX IF NOT EXISTS idx_presupuestos_reservado
  ON roldanerp.presupuestos (empresa_id)
  WHERE reservado;

NOTIFY pgrst, 'reload schema';

SELECT count(*) FILTER (WHERE reservado) AS reservados, count(*) AS presupuestos
FROM roldanerp.presupuestos;
