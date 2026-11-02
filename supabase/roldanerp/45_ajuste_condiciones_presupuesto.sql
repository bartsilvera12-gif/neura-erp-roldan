-- ===========================================================================
-- 45 · Dos correcciones a las condiciones del presupuesto
-- ---------------------------------------------------------------------------
-- El script 44 cargó las condiciones con dos cosas a corregir:
--
--   1. "El plazo de procesamiento es de 1 días hábiles" quedaba fijo, y los
--      días hábiles varían según la disponibilidad y el tipo de producto. Pasa
--      a ser {plazo}, que el documento reemplaza por el plazo de entrega
--      escrito en ESE presupuesto. Si el vendedor no escribió ninguno, sale
--      "el plazo acordado con el vendedor": mejor eso que prometer un número
--      que nadie fijó.
--
--   2. La tolerancia de las chapas es de (+/-) 2 cm por chapa, no 1 cm.
--
-- Solo toca el texto si todavía dice lo viejo: si alguien ya lo editó a mano
-- desde Configuración, se respeta lo que escribió.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuesto_plantilla') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.presupuesto_plantilla. Corré antes 44_plantilla_presupuesto.sql.';
  END IF;
END
$guard$;

UPDATE roldanerp.presupuesto_plantilla
   SET observaciones = replace(
         observaciones,
         'El plazo de procesamiento es de 1 días hábiles',
         'El plazo de procesamiento es de {plazo}'
       )
 WHERE observaciones LIKE '%El plazo de procesamiento es de 1 días hábiles%';

UPDATE roldanerp.presupuesto_plantilla
   SET observaciones = replace(
         observaciones,
         'variación de (+/-) 1 cm por chapa',
         'variación de (+/-) 2 cm por chapa'
       )
 WHERE observaciones LIKE '%variación de (+/-) 1 cm por chapa%';

COMMIT;

DO $check$
DECLARE v_plazo int; v_cm int;
BEGIN
  SELECT count(*) INTO v_plazo FROM roldanerp.presupuesto_plantilla
   WHERE observaciones LIKE '%{plazo}%';
  SELECT count(*) INTO v_cm FROM roldanerp.presupuesto_plantilla
   WHERE observaciones LIKE '%(+/-) 2 cm por chapa%';
  RAISE NOTICE 'Script 45 listo: % plantilla(s) con el plazo tipeable, % con la tolerancia en 2 cm.', v_plazo, v_cm;
END
$check$;

NOTIFY pgrst, 'reload schema';
