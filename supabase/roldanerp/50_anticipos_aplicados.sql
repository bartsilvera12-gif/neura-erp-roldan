-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 50 · Aplicar un anticipo a una venta desde Caja
-- ============================================================================
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────────────
--   Los anticipos se podían registrar (la plata que el cliente deja a cuenta)
--   y se podían anular, pero no había forma de USARLOS: cuando el cliente
--   volvía a retirar la mercadería, el cajero cobraba el total de nuevo y el
--   anticipo quedaba colgado para siempre. La pantalla de anticipos tenía un
--   "marcar como utilizado" que no descontaba nada: solo cambiaba el estado.
--
-- ── QUÉ AGREGA ────────────────────────────────────────────────────────────
--   1. `anticipos.monto_utilizado` — cuánto de ese anticipo ya se usó.
--
--      POR QUÉ NO ALCANZABA CON EL ESTADO: un anticipo de 500.000 aplicado a
--      una venta de 200.000 no está "utilizado", le quedan 300.000 a favor
--      del cliente. Con solo el estado, esos 300.000 desaparecían. El saldo
--      es `monto - monto_utilizado`, y el estado pasa a 'utilizado' recién
--      cuando ese saldo llega a cero.
--
--   2. `ventas.anticipo_aplicado` — cuánta plata de esta venta salió de un
--      anticipo en vez del cajón de HOY.
--
--      POR QUÉ ES IMPRESCINDIBLE PARA EL ARQUEO: el anticipo entró al cajón
--      el día que el cliente lo dejó, y ese turno ya lo contó. Si la venta de
--      hoy se registrara como cobrada en efectivo por el total, el arqueo de
--      hoy esperaría una plata que no está, y el cajero cerraría con faltante
--      sin haber hecho nada mal. Con este dato, el esperado descuenta la
--      parte que vino del anticipo.
--
-- ── EL BACKFILL IMPORTA ───────────────────────────────────────────────────
--   A los anticipos que ya figuran 'utilizado' se les pone
--   `monto_utilizado = monto`. Sin eso quedarían con saldo completo y
--   aparecerían como plata disponible de clientes que ya retiraron: el
--   sistema le ofrecería al cajero usar dos veces el mismo anticipo.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.anticipos') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.anticipos. Corré antes 25_caja_modulo5.sql.';
  END IF;
  IF to_regclass('roldanerp.ventas') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.ventas.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Cuánto de cada anticipo ya se usó
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.anticipos
  ADD COLUMN IF NOT EXISTS monto_utilizado numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN roldanerp.anticipos.monto_utilizado IS
  'Parte del anticipo ya aplicada a ventas. El saldo a favor del cliente es '
  'monto - monto_utilizado. El estado pasa a utilizado cuando el saldo es 0.';

-- Backfill ANTES del CHECK: si un anticipo viejo tuviera monto_utilizado 0 y
-- estado 'utilizado', el constraint pasaría igual, pero el dato quedaría
-- mintiendo. Se corrige primero y después se cierra la puerta.
UPDATE roldanerp.anticipos
   SET monto_utilizado = monto
 WHERE estado = 'utilizado'
   AND monto_utilizado < monto;

-- Un anticipo no puede tener usado más de lo que entró, ni un usado negativo.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'anticipos_monto_utilizado_rango'
       AND conrelid = 'roldanerp.anticipos'::regclass
  ) THEN
    ALTER TABLE roldanerp.anticipos
      ADD CONSTRAINT anticipos_monto_utilizado_rango
      CHECK (monto_utilizado >= 0 AND monto_utilizado <= monto);
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------
-- 2) Cuánto de la venta se pagó con anticipo
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.ventas
  ADD COLUMN IF NOT EXISTS anticipo_aplicado numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN roldanerp.ventas.anticipo_aplicado IS
  'Parte del total que se pagó con un anticipo del cliente (plata que entró a '
  'la caja en un turno anterior). El arqueo la descuenta del efectivo '
  'esperado de HOY; el total de la venta no cambia.';

DO $chk2$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ventas_anticipo_aplicado_no_negativo'
       AND conrelid = 'roldanerp.ventas'::regclass
  ) THEN
    ALTER TABLE roldanerp.ventas
      ADD CONSTRAINT ventas_anticipo_aplicado_no_negativo
      CHECK (anticipo_aplicado >= 0);
  END IF;
END
$chk2$;

-- Buscar los anticipos con saldo de un cliente es LA consulta del mostrador:
-- se hace con el cliente delante, esperando.
CREATE INDEX IF NOT EXISTS anticipos_saldo_cliente_idx
  ON roldanerp.anticipos (empresa_id, sucursal_id, cliente_id)
  WHERE estado = 'activo';

COMMIT;

-- ---------------------------------------------------------------------------
-- 3) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_incoherentes int;
  v_con_saldo int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='anticipos' AND column_name='monto_utilizado'
  ) THEN
    RAISE EXCEPTION 'Falta anticipos.monto_utilizado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='ventas' AND column_name='anticipo_aplicado'
  ) THEN
    RAISE EXCEPTION 'Falta ventas.anticipo_aplicado';
  END IF;

  -- Un 'utilizado' con saldo, o un 'activo' con todo usado, es un dato que
  -- después confunde en el mostrador. No debería quedar ninguno.
  SELECT count(*) INTO v_incoherentes
    FROM roldanerp.anticipos
   WHERE (estado = 'utilizado' AND monto_utilizado < monto)
      OR (estado = 'activo' AND monto > 0 AND monto_utilizado >= monto);
  IF v_incoherentes > 0 THEN
    RAISE WARNING 'Quedaron % anticipo(s) con estado y monto_utilizado incoherentes. Revisar a mano.', v_incoherentes;
  END IF;

  SELECT count(*) INTO v_con_saldo
    FROM roldanerp.anticipos
   WHERE estado = 'activo' AND (monto - monto_utilizado) > 0;

  RAISE NOTICE 'Script 50 listo. Anticipos activos con saldo a favor: %.', v_con_saldo;
  RAISE NOTICE 'Ahora Caja ofrece usar el anticipo cuando se elige un cliente que tiene saldo.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
