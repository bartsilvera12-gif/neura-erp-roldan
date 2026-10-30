-- ===========================================================================
-- 44 · Los textos fijos del presupuesto
-- ---------------------------------------------------------------------------
-- El presupuesto que sale impreso lleva siempre las mismas condiciones: forma
-- de pago, validez de la oferta y una lista larga de observaciones (plazos de
-- retiro, tolerancias de color, a qué cuenta se transfiere). Hoy eso se
-- escribía a mano en cada presupuesto o quedaba en el código.
--
-- Va a una tabla porque es texto que el negocio cambia —cambió una cuenta
-- bancaria, se ajusta un plazo— y no tiene por qué esperar un deploy. Una fila
-- por empresa.
--
-- El anticipo se guarda como porcentaje: el documento lo imprime en dos
-- lugares ("Anticipo del X% y saldo al retirar" y "ANTICIPO REQUERIDO (X%)"),
-- y tenerlo en un solo lado evita que queden diciendo cosas distintas.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

CREATE TABLE IF NOT EXISTS roldanerp.presupuesto_plantilla (
  empresa_id      uuid PRIMARY KEY,
  forma_pago      text NOT NULL DEFAULT 'Anticipo del {anticipo}% y saldo al retirar',
  validez         text NOT NULL DEFAULT '- Hasta el término de la jornada de la presente fecha.',
  observaciones   text NOT NULL DEFAULT '',
  anticipo_pct    numeric NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_por     text NULL
);

COMMENT ON TABLE roldanerp.presupuesto_plantilla IS
  'Textos fijos del presupuesto impreso. Los edita un administrador desde '
  'Configuración; no requieren deploy.';
COMMENT ON COLUMN roldanerp.presupuesto_plantilla.forma_pago IS
  'Admite {anticipo}, que se reemplaza por anticipo_pct al imprimir.';
COMMENT ON COLUMN roldanerp.presupuesto_plantilla.observaciones IS
  'Una condición por línea. El documento las imprime como viñetas.';

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'presupuesto_plantilla_anticipo_chk'
       AND conrelid = 'roldanerp.presupuesto_plantilla'::regclass
  ) THEN
    ALTER TABLE roldanerp.presupuesto_plantilla
      ADD CONSTRAINT presupuesto_plantilla_anticipo_chk
      CHECK (anticipo_pct >= 0 AND anticipo_pct <= 100);
  END IF;
END
$chk$;

-- Las condiciones que hoy usa Aceros Metal, tal cual salen en el documento.
INSERT INTO roldanerp.presupuesto_plantilla (empresa_id, observaciones)
SELECT e.id,
'Solo los presupuestos confirmados y abonados en el día serán facturados con los precios cotizados.
El presupuesto incluye IVA (10%). Precios expresados en guaraníes.
Precio a retirar del local. El plazo de procesamiento es de 1 días hábiles, y corre a partir de la confirmación del presupuesto y el pago del anticipo.
El cliente puede consultar con el vendedor las especificaciones técnicas y tolerancias de los productos solicitados.
Para retirar productos del local, el cliente debe enviar transporte con capacidad de carga suficiente y carrocería de largo adecuado a las características de los productos. En caso contrario, Aceros Metal no se hace responsable de las condiciones en que lleguen los productos a destino.
En entregas con flete, el cliente deberá disponer del personal para la desestiba. En caso contrario no se podrá realizar la entrega.
El plazo de retiro del material es de hasta 2 días posteriores al cumplimiento del plazo de procesamiento. En caso de no retirarse en plazo, Aceros Metal no se responsabiliza por posibles daños al material debido al manipuleo en almacenamiento.
No se garantiza uniformidad de tonalidad (color) en chapas galvalume/prepintadas de distintos lotes de producción. La variación es inevitable y se origina en el proveedor de la materia prima.
Las chapas onduladas y trapezoidales pueden presentar una variación de (+/-) 1 cm por chapa.
Solo se aceptarán transferencias realizadas a cuentas bancarias a nombre de OSCAR ROLDAN (RUC 4538617-0), y NO a cuentas bancarias de terceras personas (particulares).'
  FROM roldanerp.empresas e
 WHERE NOT EXISTS (
   SELECT 1 FROM roldanerp.presupuesto_plantilla p WHERE p.empresa_id = e.id
 );

COMMIT;

DO $check$
DECLARE v_n int; v_lineas int;
BEGIN
  SELECT count(*) INTO v_n FROM roldanerp.presupuesto_plantilla;
  SELECT count(*) INTO v_lineas
    FROM roldanerp.presupuesto_plantilla,
         LATERAL regexp_split_to_table(observaciones, E'\n') AS l
   WHERE btrim(l) <> '';
  RAISE NOTICE 'Script 44 listo: % plantilla(s), % condiciones cargadas. Se editan en Configuración.', v_n, v_lineas;
END
$check$;

NOTIFY pgrst, 'reload schema';
