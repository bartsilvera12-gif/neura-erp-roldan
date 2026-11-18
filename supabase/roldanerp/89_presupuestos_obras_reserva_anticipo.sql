-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 89 · Presupuestos: obras, reserva con vencimiento y anticipo por presupuesto
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   1) Dirección de obra en el presupuesto: que salga impresa, que se pueda
--      buscar por obra, y que las obras se CREEN y se elijan de una lista en
--      vez de escribirse cada vez (escrita a mano, la misma obra aparece con
--      tres nombres y no se encuentra).
--   2) La reserva vence: a los 3 días, o en la fecha que elija el usuario.
--      Hasta ahora una reserva no vencía nunca y la mercadería quedaba
--      apartada hasta que un administrador se acordara de quitarla.
--   3) El anticipo de cada presupuesto: 50%, 30%, lo que deje el cliente.
--      Antes era uno solo para todos (Configuración → Presupuesto).
--
-- ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
--   Las reservas que ya existen quedan sin fecha y siguen como hasta hoy
--   (no vencen): cambiarles la regla de golpe soltaría mercadería que alguien
--   prometió. Las nuevas sí vencen.
--   Un presupuesto sin anticipo propio usa el de Configuración, como siempre.
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

-- ── 1) Obras ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roldanerp.obras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  -- De quién es la obra. NULL = todavía no se sabe o es de varios.
  cliente_id   uuid,
  nombre       text NOT NULL,
  direccion    text,
  ciudad       text,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_por  text
);

COMMENT ON TABLE roldanerp.obras IS
  'Obras de los clientes (dirección de entrega del presupuesto). Se crean una '
  'vez y se eligen de la lista; el presupuesto además guarda una copia del '
  'nombre y la dirección del día, para que el papel no cambie si la obra se edita.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_obras_nombre
  ON roldanerp.obras (empresa_id, upper(nombre));

CREATE INDEX IF NOT EXISTS idx_obras_cliente
  ON roldanerp.obras (empresa_id, cliente_id);

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS obra_id         uuid,
  ADD COLUMN IF NOT EXISTS obra_nombre     text,
  ADD COLUMN IF NOT EXISTS obra_direccion  text;

CREATE INDEX IF NOT EXISTS idx_presupuestos_obra
  ON roldanerp.presupuestos (empresa_id, obra_id)
  WHERE obra_id IS NOT NULL;

-- ── 2) Reserva con vencimiento ──────────────────────────────────────────────
ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS reservado_hasta date;

COMMENT ON COLUMN roldanerp.presupuestos.reservado_hasta IS
  'Último día en que la reserva aparta mercadería. NULL = reserva anterior a '
  'este script, que no vence.';

-- ── 3) Anticipo por presupuesto ─────────────────────────────────────────────
ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS anticipo_pct numeric(5,2);

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'presupuestos_anticipo_pct_rango'
      AND conrelid = 'roldanerp.presupuestos'::regclass
  ) THEN
    ALTER TABLE roldanerp.presupuestos
      ADD CONSTRAINT presupuestos_anticipo_pct_rango
      CHECK (anticipo_pct IS NULL OR (anticipo_pct >= 0 AND anticipo_pct <= 100));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.presupuestos.anticipo_pct IS
  'Anticipo pedido en este presupuesto (%). NULL = el de Configuración → Presupuesto.';

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM roldanerp.obras)                                    AS obras,
  (SELECT count(*) FROM roldanerp.presupuestos WHERE reservado)             AS reservados,
  (SELECT count(*) FROM roldanerp.presupuestos WHERE anticipo_pct IS NOT NULL) AS con_anticipo_propio;
