-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 96 · Notificaciones leídas (la campana)
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   La campana muestra a cada puesto sus avisos (pedido del cliente): al
--   cajero los presupuestos para cobrar y las cuentas por vencer, al vendedor
--   los presupuestos que le cambiaron, a administración la falta de stock y
--   el sobrepedido, y a todos los clientes cerca del límite de crédito.
--
--   Un aviso desaparece cuando la persona entra a verlo (o, el administrador,
--   cuando lo marca como leído). Esta tabla guarda qué avisos leyó cada uno,
--   para que no le vuelvan a aparecer en otra computadora.
--
--   Sin este script la campana funciona igual, y lo leído se recuerda solo en
--   esa computadora.
--
-- Solo escribe en `roldanerp`. Idempotente. No borra ni cambia datos.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS roldanerp.notificaciones_leidas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  usuario_id  uuid NOT NULL,
  clave       text NOT NULL,
  leida_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificaciones_leidas_uniq UNIQUE (empresa_id, usuario_id, clave)
);

COMMENT ON TABLE roldanerp.notificaciones_leidas IS
  'Qué avisos de la campana leyó cada usuario. La clave identifica el aviso (por ejemplo cola:<presupuesto>, vence:<cuenta>).';

CREATE INDEX IF NOT EXISTS notificaciones_leidas_usuario_idx
  ON roldanerp.notificaciones_leidas (empresa_id, usuario_id, leida_at DESC);

COMMIT;
