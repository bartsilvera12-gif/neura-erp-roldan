import type { MonedaFlujo } from "./types";

/**
 * ¿El cheque y las facturas que cubre dicen lo mismo?
 *
 * ── EL CASO REAL QUE LO MOTIVÓ ─────────────────────────────────────────────
 *   En producción hay un cheque cargado como **128.000 USD** que cubre la
 *   factura COMP-000002, que es de **128.000 GUARANÍES**. No fue un error de
 *   tipeo: la pantalla mandaba `moneda: fila.moneda`, o sea la moneda
 *   PREFERIDA DEL PROVEEDOR, en vez de la moneda de las facturas que se están
 *   pagando. El proveedor tenía `moneda_preferida = USD` y la factura era en
 *   guaraníes, así que el cheque nació mal etiquetado con el número correcto.
 *
 *   Cualquier factura en guaraníes de un proveedor en dólares salía así.
 *
 * ── POR QUÉ IMPORTA TANTO ──────────────────────────────────────────────────
 *   El flujo de caja convierte los cheques en dólares al tipo de cambio del
 *   mes. Ese cheque, si no estuviera marcado como cobrado, proyectaría
 *   128.000 × 6.400 = **819.200.000 Gs.** de egreso donde hay una deuda de
 *   128.000. Un número así no se discute: se cree o se descarta la pantalla
 *   entera.
 *
 * ── LA CUENTA ──────────────────────────────────────────────────────────────
 *   Se lleva todo a guaraníes y se comparan los dos lados. Da igual de qué
 *   moneda venga cada uno: si el cheque paga lo que dice pagar, los dos
 *   importes en guaraníes tienen que parecerse.
 *
 *   Esto deja pasar lo legítimo —pagar una factura en dólares con un cheque en
 *   guaraníes, que es lo normal acá— porque al tipo de cambio correcto los dos
 *   lados dan lo mismo. Y frena lo que no puede ser, que es una diferencia de
 *   varios órdenes de magnitud.
 *
 *   De paso agarra el cero de más, que es el otro error caro y mucho más común
 *   que la confusión de moneda.
 */

/** A partir de esta proporción, la diferencia ya no puede ser un pago parcial. */
const FACTOR_DISPARATE = 50;

/** Tolerancia para considerar que los dos lados "dicen lo mismo". */
const TOLERANCIA = 0.02;

export interface FacturaDelCheque {
  numero_control: string;
  /** Moneda de la FACTURA, no la del proveedor ni la del cheque. */
  moneda: MonedaFlujo;
  /** Lo que se le imputa, en la moneda de la factura. */
  importe_imputado: number;
}

export interface ChequeARevisar {
  moneda: MonedaFlujo;
  importe: number;
  /**
   * Tipo de cambio para llevar los dólares a guaraníes. En 0 o ausente, la
   * comparación de importes no se puede hacer y solo se revisa la moneda.
   */
  tipoCambio?: number;
  facturas: FacturaDelCheque[];
}

export type NivelRevision = "ok" | "aviso" | "error";

export interface Revision {
  nivel: NivelRevision;
  /** Qué decirle a la persona. Vacío cuando está todo bien. */
  mensaje: string;
}

const OK: Revision = { nivel: "ok", mensaje: "" };

const gs = (n: number) => Math.round(n).toLocaleString("es-PY");

/** La moneda de un conjunto de facturas, o `null` si están mezcladas. */
export function monedaDeLasFacturas(facturas: FacturaDelCheque[]): MonedaFlujo | null {
  const monedas = new Set(facturas.map((f) => f.moneda));
  if (monedas.size === 0) return null;
  if (monedas.size > 1) return null;
  return [...monedas][0];
}

export function revisarCheque({
  moneda, importe, tipoCambio, facturas,
}: ChequeARevisar): Revision {
  // Un cheque suelto, sin facturas, no tiene contra qué compararse.
  if (facturas.length === 0) return OK;

  // ── 1) Facturas de monedas distintas en el mismo cheque ──────────────────
  // No es que esté mal pagarlas juntas: es que el cheque tiene UNA moneda y un
  // importe, y no hay forma de que represente las dos sin un tipo de cambio
  // propio que nadie cargó.
  const monedaFacturas = monedaDeLasFacturas(facturas);
  if (monedaFacturas === null) {
    return {
      nivel: "error",
      mensaje:
        "Un cheque no puede cubrir facturas en monedas distintas. Hacé un " +
        "cheque para las de guaraníes y otro para las de dólares.",
    };
  }

  // ── 2) Los dos lados, en guaraníes ───────────────────────────────────────
  const tc = Number(tipoCambio) || 0;
  const aGs = (n: number, m: MonedaFlujo) => (m === "USD" ? n * tc : n);

  const imputado = facturas.reduce((a, f) => a + (Number(f.importe_imputado) || 0), 0);

  // Sin tipo de cambio no se puede comparar nada que cruce monedas. Lo único
  // que se puede afirmar es que las etiquetas no coinciden.
  if (tc <= 0 && moneda !== monedaFacturas) {
    return {
      nivel: "aviso",
      mensaje:
        `El cheque está en ${nombre(moneda)} y la factura en ${nombre(monedaFacturas)}. ` +
        "Sin tipo de cambio cargado no se puede verificar el importe: " +
        "cargalo arriba, en el flujo de caja.",
    };
  }

  const chequeGs = aGs(Number(importe) || 0, moneda);
  const imputadoGs = aGs(imputado, monedaFacturas);
  if (imputadoGs <= 0 || chequeGs <= 0) return OK;

  const razon = chequeGs / imputadoGs;

  // ── 3) Desproporción: no puede ser un pago parcial ───────────────────────
  if (razon >= FACTOR_DISPARATE || razon <= 1 / FACTOR_DISPARATE) {
    const detalle =
      `El cheque son ${etiqueta(importe, moneda)} ` +
      `(${gs(chequeGs)} Gs.) y lo que cubre son ${etiqueta(imputado, monedaFacturas)} ` +
      `(${gs(imputadoGs)} Gs.).`;

    // Cuando además las monedas no coinciden, casi siempre es eso: se escribió
    // el número de una moneda con la etiqueta de la otra.
    if (moneda !== monedaFacturas) {
      return {
        nivel: "error",
        mensaje:
          `${detalle} Están en monedas distintas y la diferencia es de ` +
          `${Math.round(razon >= 1 ? razon : 1 / razon)} veces: lo más probable es ` +
          `que el importe esté en ${nombre(monedaFacturas)} pero el cheque quedó ` +
          `marcado en ${nombre(moneda)}.`,
      };
    }
    return {
      nivel: "error",
      mensaje: `${detalle} Esa diferencia no puede ser un pago parcial. Revisá el importe.`,
    };
  }

  // ── 4) Diferencias razonables: se avisa, no se frena ─────────────────────
  // Un pago parcial es legítimo, y pagar de más también pasa (se adelanta
  // plata). Pero que no sea en silencio.
  if (Math.abs(razon - 1) > TOLERANCIA) {
    return {
      nivel: "aviso",
      mensaje:
        razon < 1
          ? `El cheque cubre ${gs(chequeGs)} Gs. de ${gs(imputadoGs)} Gs.: queda un saldo pendiente.`
          : `El cheque es por ${gs(chequeGs)} Gs. y lo que cubre son ${gs(imputadoGs)} Gs.: ` +
            "está pagando de más.",
    };
  }

  return OK;
}

function nombre(m: MonedaFlujo): string {
  return m === "USD" ? "dólares" : "guaraníes";
}

function etiqueta(n: number, m: MonedaFlujo): string {
  return m === "USD" ? `US$ ${n.toLocaleString("es-PY")}` : `${gs(n)} Gs.`;
}
