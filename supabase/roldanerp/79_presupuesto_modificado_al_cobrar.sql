-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 79 · Qué se le cambió al presupuesto en la caja
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "sistema manda notificación a la vendedora si al cobrar se modifica el
--    presupuesto, no cambiaria el nombre de la persona a quien se hizo el
--    presupuesto, que salga la modificación del presupuesto a la hora de
--    cobrar en alguna parte de presupuesto."
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
--   La vendedora arma el presupuesto, lo manda a cobrar y ahí lo pierde de
--   vista. En la caja se le puede sacar una línea, bajar un precio o cambiar
--   una cantidad, y ella se entera —si se entera— cuando el cliente le
--   reclama algo que no ofreció, o cuando le llega una comisión que no cierra
--   con lo que vendió.
--
--   El que cobra casi nunca cambia por capricho: faltó mercadería, el cliente
--   se llevó menos, se arregló un precio. El problema no es el cambio: es que
--   no se avise.
--
-- ── POR QUÉ UNA TABLA Y NO UNA COLUMNA EN `presupuestos` ───────────────────
--   Porque el aviso tiene estado propio —se ve o no se ve— y un presupuesto
--   se puede cobrar, anular y volver a cobrar. Con una columna, el segundo
--   cobro pisaría lo que pasó en el primero, que es justo lo que alguien va a
--   querer mirar cuando haya un reclamo.
--
-- ── EL PRESUPUESTO NO CAMBIA DE DUEÑA ──────────────────────────────────────
--   Acá se guarda a quién avisarle: la vendedora que armó el presupuesto, no
--   la persona que cobró. Cobrar no transfiere el presupuesto: `vendedor_*` de
--   `presupuestos` no se toca, y esta tabla copia ese dato para que el aviso
--   siga llegando a la misma persona aunque después se la cambie de puesto.
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

CREATE TABLE IF NOT EXISTS roldanerp.presupuesto_cambios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  presupuesto_id     uuid NOT NULL REFERENCES roldanerp.presupuestos(id) ON DELETE CASCADE,
  presupuesto_numero text,
  -- La venta que lo cobró, para poder ir a verla.
  venta_id           uuid,
  venta_numero       text,

  -- A quién avisarle: quien armó el presupuesto.
  vendedor_usuario_id uuid,
  vendedor_nombre     text,
  -- Quién cobró. No es lo mismo, y esa es toda la cuestión.
  cobrado_por_id      uuid,
  cobrado_por_nombre  text,

  -- La lista de cambios, tal como se muestra: [{tipo, producto_nombre, antes, despues}]
  cambios            jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_presupuesto  numeric NOT NULL DEFAULT 0,
  total_cobrado      numeric NOT NULL DEFAULT 0,

  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Cuándo lo vio la vendedora. NULL = todavía no lo vio.
  visto_at           timestamptz
);

COMMENT ON TABLE roldanerp.presupuesto_cambios IS
  'Lo que se le cambió a un presupuesto al cobrarlo en la caja, y a quién hay '
  'que avisarle. Solo se escribe si algo cambió: avisar de lo que no cambió '
  'entrena a ignorar los avisos.';

COMMENT ON COLUMN roldanerp.presupuesto_cambios.vendedor_usuario_id IS
  'La vendedora que armó el presupuesto. Cobrar no le transfiere el '
  'presupuesto a quien cobró: el aviso le llega a ella.';

-- Lo que se pregunta siempre: "¿qué tengo sin ver?".
CREATE INDEX IF NOT EXISTS idx_presupuesto_cambios_sin_ver
  ON roldanerp.presupuesto_cambios (empresa_id, vendedor_usuario_id, visto_at);

CREATE INDEX IF NOT EXISTS idx_presupuesto_cambios_presu
  ON roldanerp.presupuesto_cambios (empresa_id, presupuesto_id, created_at DESC);

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                                   AS avisos,
  count(*) FILTER (WHERE visto_at IS NULL)   AS sin_ver,
  count(DISTINCT vendedor_usuario_id)        AS vendedoras_avisadas
FROM roldanerp.presupuesto_cambios;
