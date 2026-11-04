/**
 * Pagar una compra desde la caja.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Poner que la compra se pueda pagar de caja y el método que sea cheque
 *   también."
 *
 * ── LO QUE YA ESTABA Y LO QUE FALTABA ──────────────────────────────────────
 *   La cañería existía: marcar una compra como `pagada` ya descontaba la plata
 *   del turno abierto. Lo que faltaba era poder llegar ahí — el listado de
 *   Compras tenía Anular y Eliminar, pero no Pagar — y que el método pudiera
 *   ser cheque: la ruta aceptaba efectivo, transferencia y tarjeta, y cualquier
 *   otra cosa la guardaba como `null`, en silencio.
 *
 * ── CUÁL DE LOS CUATRO SALE DEL CAJÓN ──────────────────────────────────────
 *   Solo el efectivo. Un cheque o una transferencia salen del BANCO: quedan
 *   registrados en el turno para que se vea qué se pagó ese día, pero no bajan
 *   el efectivo esperado del arqueo. Si lo bajaran, el cajero contaría bien y
 *   el sistema le marcaría un faltante por el monto del cheque.
 *
 *   Esto no es una regla nueva: el arqueo ya la aplica — saltea todo movimiento
 *   cuyo medio no sea efectivo. Acá está escrita para poder DECÍRSELO a la
 *   persona antes de que apriete, en vez de que lo deduzca del arqueo.
 *
 * ── POR QUÉ IMPORTA MARCARLO COMO 'proveedor' ──────────────────────────────
 *   El reporte de Ganancias excluye los egresos de caja con
 *   `tipo_egreso = 'proveedor'` de los gastos operativos, porque esa plata es
 *   el costo de la mercadería y ya está contada en el CMV. Un pago a proveedor
 *   que entre como "otros" se cuenta DOS VECES y hunde la ganancia neta.
 */

export type MedioPagoCompra = "efectivo" | "transferencia" | "tarjeta" | "cheque";

export interface MedioInfo {
  clave: MedioPagoCompra;
  label: string;
  /** true = baja el efectivo esperado del arqueo. */
  saleDelCajon: boolean;
  /** Qué avisarle a la persona al elegirlo. */
  nota: string;
}

export const MEDIOS_PAGO_COMPRA: readonly MedioInfo[] = [
  {
    clave: "efectivo",
    label: "Efectivo",
    saleDelCajon: true,
    nota: "Sale del cajón: baja el efectivo esperado del arqueo de este turno.",
  },
  {
    clave: "transferencia",
    label: "Transferencia",
    saleDelCajon: false,
    nota: "Sale del banco. Queda registrado en el turno, pero no toca el efectivo del arqueo.",
  },
  {
    clave: "cheque",
    label: "Cheque",
    saleDelCajon: false,
    nota: "Sale del banco cuando lo cobren. Queda registrado en el turno, pero no toca el efectivo del arqueo.",
  },
  {
    clave: "tarjeta",
    label: "Tarjeta",
    saleDelCajon: false,
    nota: "Sale de la tarjeta. Queda registrado en el turno, pero no toca el efectivo del arqueo.",
  },
];

export function esMedioPagoCompra(v: unknown): v is MedioPagoCompra {
  return MEDIOS_PAGO_COMPRA.some((m) => m.clave === v);
}

/** El medio, normalizado, o `null` si no es ninguno de los cuatro. */
export function normalizarMedioCompra(v: unknown): MedioPagoCompra | null {
  const s = String(v ?? "").trim().toLowerCase();
  return esMedioPagoCompra(s) ? s : null;
}

export function infoMedio(v: unknown): MedioInfo | null {
  const m = normalizarMedioCompra(v);
  return m ? MEDIOS_PAGO_COMPRA.find((x) => x.clave === m) ?? null : null;
}

/** Solo el efectivo baja el efectivo esperado del arqueo. */
export function saleDelCajon(v: unknown): boolean {
  return infoMedio(v)?.saleDelCajon === true;
}

export type NivelResultado = "ok" | "aviso";

export interface ResultadoPago {
  nivel: NivelResultado;
  mensaje: string;
}

/**
 * Qué decirle a la persona después de pagar.
 *
 * El caso que hay que avisar sí o sí es el tercero: la compra quedó pagada
 * pero no había ningún turno abierto, así que la plata no salió de ninguna
 * caja. Antes eso pasaba en silencio — la pantalla decía "pagada" igual — y el
 * faltante aparecía recién al cerrar, sin forma de saber de dónde venía.
 */
export function resultadoDelPago({
  medio, cajaMovimientoId, numeroControl,
}: {
  medio: unknown;
  /** El id que devolvió el servidor, o null si no se registró en ninguna caja. */
  cajaMovimientoId: string | null;
  numeroControl?: string;
}): ResultadoPago {
  const info = infoMedio(medio);
  const compra = numeroControl ? ` ${numeroControl}` : "";

  if (!cajaMovimientoId) {
    return {
      nivel: "aviso",
      mensaje:
        `La compra${compra} quedó pagada, pero no había ningún turno de caja ` +
        "abierto, así que el pago no se registró en ninguna caja. Si la plata " +
        "salió del cajón, cargá el egreso a mano cuando abras el turno.",
    };
  }

  if (info?.saleDelCajon) {
    return {
      nivel: "ok",
      mensaje: `Pagada${compra} en efectivo. Salió del cajón: el arqueo de este turno ya lo espera.`,
    };
  }

  return {
    nivel: "ok",
    mensaje:
      `Pagada${compra} por ${info ? info.label.toLowerCase() : "otro medio"}. ` +
      "Quedó registrada en el turno, pero no baja el efectivo del arqueo porque no salió del cajón.",
  };
}
