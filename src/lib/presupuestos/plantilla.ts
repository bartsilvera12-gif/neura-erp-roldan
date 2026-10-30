/**
 * Los textos fijos del presupuesto impreso.
 *
 * Viven en `presupuesto_plantilla` (script 44) y los edita un administrador
 * desde Configuración. Acá están los mismos valores por defecto que trae el
 * script, para que el documento salga completo aunque la tabla todavía no
 * exista: un presupuesto sin sus condiciones es un presupuesto que después se
 * discute.
 */

export interface PlantillaPresupuesto {
  /** Admite `{anticipo}`, que se reemplaza por el porcentaje al imprimir. */
  forma_pago: string;
  validez: string;
  /** Una condición por línea. */
  observaciones: string;
  anticipo_pct: number;
}

export const PLANTILLA_POR_DEFECTO: PlantillaPresupuesto = {
  forma_pago: "Anticipo del {anticipo}% y saldo al retirar",
  validez: "- Hasta el término de la jornada de la presente fecha.",
  observaciones: [
    "Solo los presupuestos confirmados y abonados en el día serán facturados con los precios cotizados.",
    "El presupuesto incluye IVA (10%). Precios expresados en guaraníes.",
    "Precio a retirar del local. El plazo de procesamiento es de 1 días hábiles, y corre a partir de la confirmación del presupuesto y el pago del anticipo.",
    "El cliente puede consultar con el vendedor las especificaciones técnicas y tolerancias de los productos solicitados.",
    "Para retirar productos del local, el cliente debe enviar transporte con capacidad de carga suficiente y carrocería de largo adecuado a las características de los productos. En caso contrario, Aceros Metal no se hace responsable de las condiciones en que lleguen los productos a destino.",
    "En entregas con flete, el cliente deberá disponer del personal para la desestiba. En caso contrario no se podrá realizar la entrega.",
    "El plazo de retiro del material es de hasta 2 días posteriores al cumplimiento del plazo de procesamiento. En caso de no retirarse en plazo, Aceros Metal no se responsabiliza por posibles daños al material debido al manipuleo en almacenamiento.",
    "No se garantiza uniformidad de tonalidad (color) en chapas galvalume/prepintadas de distintos lotes de producción. La variación es inevitable y se origina en el proveedor de la materia prima.",
    "Las chapas onduladas y trapezoidales pueden presentar una variación de (+/-) 1 cm por chapa.",
    "Solo se aceptarán transferencias realizadas a cuentas bancarias a nombre de OSCAR ROLDAN (RUC 4538617-0), y NO a cuentas bancarias de terceras personas (particulares).",
  ].join("\n"),
  anticipo_pct: 0,
};

/**
 * Reemplaza `{anticipo}` por el porcentaje configurado.
 *
 * El porcentaje aparece en dos lugares del documento —la forma de pago y el
 * renglón del anticipo requerido— y tenerlo en un solo dato evita que queden
 * diciendo cosas distintas.
 */
export function formaPagoConAnticipo(formaPago: string, anticipoPct: number): string {
  const pct = Number(anticipoPct);
  const texto = Number.isFinite(pct)
    ? pct.toLocaleString("es-PY", { maximumFractionDigits: 2 })
    : "0";
  return String(formaPago ?? "").replace(/\{anticipo\}/g, texto);
}
