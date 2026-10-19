/**
 * Flujo de caja de proveedores.
 *
 * Proyección de los pagos a proveedores día por día, con el estado del cheque
 * que los cubre. Reemplaza la planilla que hoy se lleva a mano.
 *
 * Reglas del negocio (definidas con el cliente):
 *  · Una factura de compra a crédito cae en `fecha_factura + plazo_dias`.
 *  · Un cheque es de UN proveedor y puede cubrir VARIAS facturas suyas.
 *  · Un cheque cobrado ya salió del banco: deja de proyectarse (en la planilla
 *    se lo multiplicaba por cero).
 *  · Los proveedores chicos o locales no llevan fila propia: se suman en VARIOS.
 */

export type MonedaFlujo = "PYG" | "USD";

/** Estados del cheque. Entre paréntesis, el color que usaban en la planilla. */
export type EstadoCheque =
  | "pendiente_emision" // lila
  | "emitido"           // verde
  | "cobrado"           // amarillo — fuera del flujo
  | "anulado";

/** Una factura o cheque dentro de una celda del flujo. */
export interface EntradaFlujo {
  /** `cheque` si ya hay uno; `factura` si la compra todavía no tiene cheque. */
  tipo: "cheque" | "factura";
  cheque_id: string | null;
  /** Estado efectivo. Una factura sin cheque se trata como pendiente de emisión. */
  estado: EstadoCheque;
  moneda: MonedaFlujo;
  /** En la moneda de la entrada. */
  importe: number;
  /** Equivalente en guaraníes al tipo de cambio del mes. */
  importe_gs: number;

  // — Lo que iba en los comentarios de la planilla —
  /** Número de la factura del proveedor. */
  numero_factura: string | null;
  /** Número de carga en el sistema (COMP-000001). */
  numero_control: string | null;
  /** Varias facturas si el cheque cubre más de una. */
  facturas: { numero_control: string; numero_factura: string | null; importe_imputado: number }[];
  numero_cheque: string | null;
  banco_nombre: string | null;
  fecha_emision: string | null;
  /** La fecha de cobro puede diferir de la de pago: por eso va aparte. */
  fecha_cobro: string | null;
  observacion: string | null;
}

/** Una fila del flujo: un proveedor, o la fila agrupada VARIOS. */
export interface FilaFlujo {
  proveedor_id: string | null;
  /** `VARIOS` cuando agrupa a los proveedores chicos. */
  nombre: string;
  es_varios: boolean;
  moneda: MonedaFlujo;
  /** Entradas por día del mes: la clave es el día (1..31). */
  dias: Record<number, EntradaFlujo[]>;
  /** Total del mes en la moneda de la fila, sin contar cobrados ni anulados. */
  total: number;
}

/** Totales de una columna (un día). */
export interface TotalesDia {
  dia: number;
  subtotal_usd: number;
  subtotal_gs: number;
  /** subtotal_usd × tipo_cambio + subtotal_gs */
  egreso_gs: number;
  /** Fondos que quedan después de los pagos de ese día. */
  acumulado_gs: number;
  /** El acumulado llevado a dólares al tipo de cambio del mes. */
  acumulado_usd: number;
}

export interface FlujoCajaConfig {
  anio: number;
  mes: number;
  /** Cotización que fija el cliente, normalmente por encima de la real. */
  tipo_cambio: number;
  /** Dinero a favor al inicio del mes, en guaraníes. */
  fondos_disponibles: number;
  observacion: string | null;
}

export interface FlujoCajaMes {
  config: FlujoCajaConfig;
  /** Cantidad de días del mes. */
  dias: number;
  filas: FilaFlujo[];
  totales: TotalesDia[];
  /** Suma del mes, sin contar cobrados ni anulados. */
  resumen: {
    total_usd: number;
    total_gs: number;
    egreso_total_gs: number;
    acumulado_final_gs: number;
  };
}
