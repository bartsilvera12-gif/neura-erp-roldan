/**
 * Las formas de pago que se pueden elegir en un presupuesto.
 *
 * ── POR QUÉ UNA LISTA Y NO TEXTO LIBRE ────────────────────────────────────
 * Se pidió en la reunión: "forma de pago con opciones predefinidas en lugar de
 * texto libre". Escrito a mano, cada vendedor inventa la suya —"50% anticipo",
 * "mitad y mitad", "adelanto del 50%"— y el documento que firma el cliente
 * dice algo distinto cada vez. Además son condiciones comerciales: no las
 * define quien atiende, las define la casa.
 *
 * ── `{anticipo}` ──────────────────────────────────────────────────────────
 * La opción con anticipo lleva el marcador `{anticipo}`, que se reemplaza por
 * el porcentaje configurado en Configuración → Presupuesto al imprimir (ver
 * `formaPagoConAnticipo`). Así cambiar el porcentaje no obliga a reescribir
 * cada presupuesto.
 */

export interface FormaPagoOpcion {
  /** Lo que se guarda y se imprime. */
  valor: string;
  /** Lo que se ve en el desplegable. */
  etiqueta: string;
}

export const FORMAS_PAGO: readonly FormaPagoOpcion[] = [
  { valor: "Contado", etiqueta: "Contado" },
  { valor: "Contado contra entrega", etiqueta: "Contado contra entrega" },
  {
    valor: "Anticipo del {anticipo}% y saldo al retirar",
    etiqueta: "Anticipo y saldo al retirar",
  },
  {
    valor: "Anticipo del {anticipo}% y saldo contra entrega",
    etiqueta: "Anticipo y saldo contra entrega",
  },
  { valor: "Transferencia bancaria", etiqueta: "Transferencia bancaria" },
  { valor: "Cheque al día", etiqueta: "Cheque al día" },
  { valor: "Crédito a 30 días", etiqueta: "Crédito a 30 días" },
] as const;

/** Si un texto es una de las opciones de la lista. */
export function esFormaPagoConocida(valor: string | null | undefined): boolean {
  const v = String(valor ?? "").trim();
  if (v === "") return false;
  return FORMAS_PAGO.some((f) => f.valor === v);
}

/**
 * Lo que hay que mostrar en el desplegable para un valor guardado.
 *
 * Los presupuestos viejos tienen formas de pago escritas a mano que no están en
 * la lista. No se borran ni se traducen a la fuerza: se muestran como están,
 * marcadas, para que se vea cuáles vienen de antes. Pisarlas cambiaría la
 * condición de un presupuesto que el cliente ya tiene en la mano.
 */
export function etiquetaFormaPago(valor: string | null | undefined): string {
  const v = String(valor ?? "").trim();
  if (v === "") return "";
  return FORMAS_PAGO.find((f) => f.valor === v)?.etiqueta ?? v;
}
