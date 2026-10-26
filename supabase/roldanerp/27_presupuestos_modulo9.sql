-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 27 · Módulo 9 · Presupuestos
-- ============================================================================
--
-- Punto 9.4: "Presentación: azul, observaciones y condiciones comerciales
-- editables, diseño formal."
--
-- ── POR QUÉ UNA COLUMNA NUEVA Y NO LAS QUE YA HAY ──────────────────────────
--   El presupuesto ya tiene `forma_pago`, `plazo_entrega` y `observaciones`.
--   Las dos primeras son campos de un renglón cada uno y la tercera es la nota
--   para el cliente ("el color del caño es el de la muestra").
--
--   Las condiciones comerciales son otra cosa: el texto legal que acompaña la
--   oferta —garantía, flete, quién paga la descarga, qué pasa si el dólar se
--   mueve antes de la entrega—. Es un bloque de varios renglones, cambia por
--   cliente y por obra, y es lo que se discute si después hay un reclamo.
--   Metido en observaciones se mezclaría con las notas del producto y nadie
--   sabría cuál de los dos textos es el que obliga.
--
-- ── 9.1, 9.2 y 9.3 NO NECESITAN BASE DE DATOS ──────────────────────────────
--   · 9.1 (cotizar sin restricción de stock) ya se cumple: los presupuestos
--     nunca tocaron stock. Lo que faltaba era el aviso en pantalla.
--   · 9.2 (físico / reservado / disponible) se calcula desde los presupuestos
--     aprobados vigentes. Una columna `stock_reservado` habría que mantener al
--     día en cada aprobación, conversión, vencimiento y edición: el primer
--     camino que se olvide deja el número mintiendo para siempre.
--   · 9.3 (vigencia) ya existe: `validez_dias` y `fecha_vencimiento`.
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
  ADD COLUMN IF NOT EXISTS condiciones_comerciales text NULL;

COMMENT ON COLUMN roldanerp.presupuestos.condiciones_comerciales IS
  'Condiciones comerciales de la oferta (garantía, flete, validez del precio). '
  'Texto libre de varios renglones, distinto de observaciones.';

-- Un texto vacío no es lo mismo que "sin condiciones": se guarda NULL para que
-- el PDF no imprima un título con nada abajo.
UPDATE roldanerp.presupuestos
   SET condiciones_comerciales = NULL
 WHERE condiciones_comerciales IS NOT NULL
   AND btrim(condiciones_comerciales) = '';

DO $verif$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'roldanerp' AND table_name = 'presupuestos'
       AND column_name = 'condiciones_comerciales'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'No quedo creada presupuestos.condiciones_comerciales.';
  END IF;
  RAISE NOTICE '9.4 listo: condiciones_comerciales en presupuestos.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
