-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 62 · Presupuestos: ¿el cliente salió del sistema o se escribió a mano?
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Poner un filtro para clientes creados o clientes del sistema": separar en
--   la lista de presupuestos las cotizaciones hechas a un cliente que ya
--   estaba cargado, de las hechas a uno escrito a mano en el mostrador.
--
-- ── POR QUÉ HACE FALTA UNA COLUMNA ─────────────────────────────────────────
--   Después de guardar, los dos casos se ven iguales: cuando el cliente se
--   escribe a mano y tiene todos sus datos, el presupuesto le abre la ficha,
--   y a partir de ahí `cliente_id` apunta a un cliente del sistema igual que
--   si se lo hubiera elegido del catálogo. La diferencia es cómo entró, y eso
--   no queda registrado en ninguna parte.
--
--   `cliente_id IS NULL` tampoco alcanza: eso solo marca los borradores —los
--   que todavía no tienen ficha—, no los que se escribieron a mano y sí la
--   tienen.
--
-- ── LO VIEJO QUEDA EN "DEL SISTEMA" ────────────────────────────────────────
--   De los presupuestos ya cargados no se puede saber cómo entró el cliente,
--   así que arrancan en false. Los que no tienen ficha (borradores) sí se
--   marcan, porque de esos sí se sabe.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.presupuestos. Correr antes el script 01.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS cliente_a_mano boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN roldanerp.presupuestos.cliente_a_mano IS
  'true = el cliente se escribió a mano al cotizar, no se eligió del catálogo. '
  'Se guarda al crear el presupuesto y no cambia después, aunque más tarde se '
  'le abra la ficha: lo que registra es cómo entró.';

-- Los que no tienen ficha se escribieron a mano, seguro. Del resto no se sabe.
UPDATE roldanerp.presupuestos
   SET cliente_a_mano = true
 WHERE cliente_id IS NULL
   AND cliente_a_mano = false;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE cliente_a_mano)        AS escritos_a_mano,
  count(*) FILTER (WHERE NOT cliente_a_mano)    AS del_sistema,
  count(*)                                      AS total
FROM roldanerp.presupuestos;
