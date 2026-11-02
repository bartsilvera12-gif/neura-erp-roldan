-- ===========================================================================
-- 48 · Modificaciones administrativas
-- ---------------------------------------------------------------------------
-- Ya hay historiales sueltos: `ventas_ediciones` guarda los cambios de una
-- venta, `precios_historial` los de un precio, `cliente_historial` los de una
-- ficha. Sirven para mirar UNA cosa, pero no contestan la pregunta que
-- realmente se hace: "¿qué tocó el administrador esta semana?".
--
-- Esta tabla es ese único lugar. No reemplaza a las otras —que guardan el
-- detalle campo por campo— sino que deja el rastro transversal: qué se tocó,
-- quién lo tocó, cuándo, y si era administrador.
--
-- El nombre se guarda al lado del id a propósito: si mañana ese usuario se da
-- de baja o le cambian el nombre, el registro tiene que seguir diciendo quién
-- fue. Un rastro que depende de un JOIN con una tabla que cambia no es un
-- rastro.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

CREATE TABLE IF NOT EXISTS roldanerp.modificaciones_administrativas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  sucursal_id   uuid NULL,
  /** Qué se tocó: 'venta', 'caja', 'presupuesto', 'producto', 'comisiones'… */
  entidad       text NOT NULL,
  entidad_id    uuid NULL,
  /** El número que el usuario reconoce (VTA-000018, PRE-0007). */
  referencia    text NULL,
  /** Qué se hizo: 'editar', 'anular', 'reabrir', 'cambiar_pago', 'configurar'… */
  accion        text NOT NULL,
  /** En palabras, para que se lea sin descifrar nada. */
  detalle       text NULL,
  motivo        text NULL,
  usuario_id    uuid NULL,
  usuario_nombre text NOT NULL,
  /** Si quien lo hizo era administrador en ese momento. */
  es_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.modificaciones_administrativas IS
  'Rastro transversal de lo que toca un administrador: qué, quién, cuándo. '
  'El detalle campo por campo sigue en los historiales de cada módulo.';

-- La consulta real es "los últimos movimientos", a veces filtrando por
-- persona o por entidad.
CREATE INDEX IF NOT EXISTS modif_admin_fecha_idx
  ON roldanerp.modificaciones_administrativas (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS modif_admin_entidad_idx
  ON roldanerp.modificaciones_administrativas (empresa_id, entidad, entidad_id);

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'modif_admin_nombre_chk'
       AND conrelid = 'roldanerp.modificaciones_administrativas'::regclass
  ) THEN
    -- Un registro sin nombre no sirve para nada: la tabla existe justamente
    -- para poder decir quién fue.
    ALTER TABLE roldanerp.modificaciones_administrativas
      ADD CONSTRAINT modif_admin_nombre_chk CHECK (btrim(usuario_nombre) <> '');
  END IF;
END
$chk$;

COMMIT;

DO $check$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM roldanerp.modificaciones_administrativas;
  RAISE NOTICE 'Script 48 listo: tabla modificaciones_administrativas con % fila(s). Se ve en Reportes → Modificaciones administrativas.', v_n;
END
$check$;

NOTIFY pgrst, 'reload schema';
