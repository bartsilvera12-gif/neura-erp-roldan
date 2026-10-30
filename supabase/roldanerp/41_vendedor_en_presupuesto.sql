-- ===========================================================================
-- 41 · El presupuesto puede ser de otro vendedor
-- ---------------------------------------------------------------------------
-- Hasta ahora el presupuesto guardaba solo quién lo cargó (`usuario_id`), y
-- eso alcanzaba porque siempre era la misma persona. Pero el administrador
-- arma presupuestos para que los atienda una vendedora: el que lo escribió y
-- el que lo trabaja no son el mismo.
--
-- Se separan los dos papeles, igual que en las ventas (script 33):
--   usuario_id / usuario_nombre        → quién lo cargó (no se toca)
--   vendedor_usuario_id / vendedor_nombre → de quién es el presupuesto
--
-- El nombre se guarda al lado del id a propósito: si mañana ese usuario se da
-- de baja o le cambian el nombre, el presupuesto tiene que seguir diciendo
-- quién lo atendía cuando se hizo.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.presupuestos.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS vendedor_usuario_id uuid NULL,
  ADD COLUMN IF NOT EXISTS vendedor_nombre     text NULL;

COMMENT ON COLUMN roldanerp.presupuestos.vendedor_usuario_id IS
  'De quién es el presupuesto. Puede ser distinto de usuario_id, que es quien '
  'lo cargó: el administrador arma presupuestos para que los atienda otro.';
COMMENT ON COLUMN roldanerp.presupuestos.vendedor_nombre IS
  'Nombre del vendedor al momento de crear el presupuesto, para que el '
  'documento siga siendo legible si el usuario cambia de nombre o se da de baja.';

-- Para la pantalla "mis presupuestos" de cada vendedor.
CREATE INDEX IF NOT EXISTS presupuestos_vendedor_idx
  ON roldanerp.presupuestos (empresa_id, vendedor_usuario_id, fecha DESC)
  WHERE vendedor_usuario_id IS NOT NULL;

-- Los que ya existen son de quien los cargó: antes no había otra opción.
UPDATE roldanerp.presupuestos
   SET vendedor_usuario_id = usuario_id,
       vendedor_nombre     = usuario_nombre
 WHERE vendedor_usuario_id IS NULL
   AND usuario_id IS NOT NULL;

COMMIT;

DO $check$
DECLARE v_total int; v_con int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos'
       AND column_name='vendedor_usuario_id'
  ) THEN
    RAISE EXCEPTION 'Falta la columna presupuestos.vendedor_usuario_id';
  END IF;

  SELECT count(*), count(vendedor_usuario_id) INTO v_total, v_con
    FROM roldanerp.presupuestos;
  RAISE NOTICE 'Script 41 listo: % presupuestos, % con vendedor asignado.', v_total, v_con;
END
$check$;

NOTIFY pgrst, 'reload schema';
