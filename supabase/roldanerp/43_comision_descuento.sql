-- ===========================================================================
-- 43 · El descuento afecta la comisión
-- ---------------------------------------------------------------------------
-- La comisión se paga sobre la FACTURACIÓN, no sobre la ganancia. Pero un
-- porcentaje plano sobre la facturación premia vender barato: el que regala
-- margen para cerrar rápido cobra lo mismo que el que defendió el precio.
--
-- La regla pedida mira el descuento contra la utilidad: si el descuento se
-- comió el 30% de la utilidad que tenía esa venta a precio de lista, la
-- comisión baja 30%. Sin descuento, se comisiona normal.
--
--     factor   = utilidad_real / utilidad_de_lista   (entre 0 y 1)
--     comisión = porcentaje × facturado × factor
--
-- Queda configurable y no clavado en el código: quién comisiona y cuánto es
-- una decisión del negocio, y cambia.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.comisiones_config') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.comisiones_config. Corré antes 24_comisiones_cartera.sql.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.comisiones_config
  ADD COLUMN IF NOT EXISTS penaliza_descuento boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS penalizacion_maxima_pct numeric NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'comisiones_config_penalizacion_chk'
       AND conrelid = 'roldanerp.comisiones_config'::regclass
  ) THEN
    -- Un tope del 100% es "puede llegar a no cobrar comisión". Más que eso no
    -- significa nada, y menos que cero tampoco.
    ALTER TABLE roldanerp.comisiones_config
      ADD CONSTRAINT comisiones_config_penalizacion_chk
      CHECK (penalizacion_maxima_pct IS NULL
             OR (penalizacion_maxima_pct >= 0 AND penalizacion_maxima_pct <= 100));
  END IF;
END
$chk$;

COMMENT ON COLUMN roldanerp.comisiones_config.penaliza_descuento IS
  'Si el descuento recorta la comisión en la misma proporción en que se comió '
  'la utilidad. Solo aplica con base_calculo = facturacion: sobre el margen el '
  'descuento ya pega solo.';
COMMENT ON COLUMN roldanerp.comisiones_config.penalizacion_maxima_pct IS
  'Tope de cuánto puede recortarse la comisión por descuento. NULL = sin tope '
  '(puede llegar a cero). 50 = nunca se le saca más de la mitad.';

-- Lo pedido: comisión sobre la facturación, con el descuento afectando.
UPDATE roldanerp.comisiones_config
   SET base_calculo = 'facturacion'
 WHERE base_calculo IS DISTINCT FROM 'facturacion';

COMMIT;

DO $check$
DECLARE v_base text; v_pen boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='comisiones_config'
       AND column_name='penaliza_descuento'
  ) THEN
    RAISE EXCEPTION 'Falta la columna comisiones_config.penaliza_descuento';
  END IF;

  SELECT base_calculo, penaliza_descuento INTO v_base, v_pen
    FROM roldanerp.comisiones_config LIMIT 1;
  RAISE NOTICE 'Script 43 listo. base_calculo=% penaliza_descuento=%. Se cambia desde Comisiones → Configuración.', v_base, v_pen;
END
$check$;

NOTIFY pgrst, 'reload schema';
