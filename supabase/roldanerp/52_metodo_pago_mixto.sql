-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 52 · El pago mixto nunca quedaba marcado como mixto
-- ============================================================================
--
-- ── EL BUG ────────────────────────────────────────────────────────────────
--   Cuando el cajero cobra una venta con dos medios (parte efectivo, parte
--   transferencia), `/api/ventas/create` guarda las dos líneas en
--   `ventas_pagos_detalle` y después marca la venta con
--   `metodo_pago = 'mixto'`.
--
--   Ese UPDATE FALLA. El CHECK de la columna acepta solo efectivo, tarjeta,
--   transferencia y cheque; 'mixto' no está en la lista. Y como el update
--   vive dentro de un try/catch best-effort que solo escribe en el log, la
--   venta se guarda igual y nadie se entera.
--
-- ── POR QUÉ IMPORTA, EN PLATA ─────────────────────────────────────────────
--   El resumen de caja desglosa los medios de pago así:
--
--       if (v.metodo_pago === "mixto" && desglose) { ...usar el desglose... }
--       else if (v.metodo_pago === "tarjeta") ...
--       else  → suma TODO al efectivo
--
--   Si la venta nunca llega a decir 'mixto', ese `if` no entra nunca: una
--   venta de 1.000.000 cobrada 400.000 en efectivo y 600.000 por
--   transferencia se cuenta como 1.000.000 de efectivo. El arqueo espera
--   600.000 que no están en el cajón y el cajero cierra con un faltante que
--   no cometió.
--
--   Se encontró migrando el histórico del sistema anterior: la base rechazó
--   las ventas mixtas y por eso salió a la luz.
--
-- ── QUÉ HACE ESTE SCRIPT ──────────────────────────────────────────────────
--   Agrega 'mixto' a los valores permitidos. No cambia ninguna fila: solo
--   deja de prohibir lo que la aplicación ya intentaba escribir.
--
--   El histórico migrado NO usa 'mixto' (quedó con el medio con el que se
--   pagó la mayor parte y el desglose escrito en la observación), así que
--   correr esto no lo modifica. Es para las ventas nuevas.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $arreglo$
DECLARE
  v_nombre text;
BEGIN
  -- El CHECK puede llamarse distinto según cómo se creó la tabla: se busca
  -- cuál es el que mira `metodo_pago` en vez de suponer el nombre.
  SELECT con.conname INTO v_nombre
    FROM pg_constraint con
   WHERE con.conrelid = 'roldanerp.ventas'::regclass
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%metodo_pago%'
   LIMIT 1;

  IF v_nombre IS NULL THEN
    RAISE NOTICE 'No hay CHECK sobre ventas.metodo_pago: no hay nada que corregir.';
    RETURN;
  END IF;

  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = v_nombre AND conrelid = 'roldanerp.ventas'::regclass) ILIKE '%mixto%' THEN
    RAISE NOTICE 'El CHECK % ya acepta mixto.', v_nombre;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE roldanerp.ventas DROP CONSTRAINT %I', v_nombre);
  EXECUTE format(
    'ALTER TABLE roldanerp.ventas ADD CONSTRAINT %I CHECK (metodo_pago IS NULL OR metodo_pago IN (%L,%L,%L,%L,%L))',
    v_nombre, 'efectivo', 'tarjeta', 'transferencia', 'cheque', 'mixto'
  );
  RAISE NOTICE 'Listo: % ahora acepta mixto.', v_nombre;
END
$arreglo$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_constraint con
   WHERE con.conrelid = 'roldanerp.ventas'::regclass
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%metodo_pago%'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE 'Script 52: no hay CHECK sobre metodo_pago (nada que verificar).';
  ELSIF v_def ILIKE '%mixto%' THEN
    RAISE NOTICE 'Script 52 listo: el pago mixto ya se puede guardar.';
  ELSE
    RAISE EXCEPTION 'El CHECK sigue sin aceptar mixto: %', v_def;
  END IF;
END
$verif$;

NOTIFY pgrst, 'reload schema';
