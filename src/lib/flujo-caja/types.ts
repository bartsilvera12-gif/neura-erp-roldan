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
 *  · El mes abre con lo que quedó del anterior, salvo que tenga fondos propios
 *    cargados (ver `arrastre.ts`).
 *  · El Disponible suma las cobranzas que vencen y resta los pagos. Antes solo
 *    restaba, y por eso todo mes nuevo salía en rojo.
 */

import type { OrigenFondos } from "./arrastre";

export type { OrigenFondos };

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
  /** Con qué se paga: cheque, transferencia, efectivo. Null si todavía no hay pago. */
  medio?: string | null;
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
  /**
   * Totales del mes, separados por moneda y sin contar cobrados ni anulados.
   * Van separados porque un proveedor en dólares puede tener alguna factura en
   * guaraníes: sumarlas juntas daría un número sin sentido.
   */
  total_usd: number;
  total_gs: number;
}

/** Totales de una columna (un día). */
export interface TotalesDia {
  dia: number;
  subtotal_usd: number;
  subtotal_gs: number;
  /** subtotal_usd × tipo_cambio + subtotal_gs */
  egreso_gs: number;
  /**
   * Cobranzas que vencen ese día: el saldo de las cuentas por cobrar.
   *
   * Hasta que existió esta columna el Disponible solo restaba, y un flujo de
   * caja de una sola dirección contesta "cuánto me queda si no cobro nada en
   * todo el mes", que no es la pregunta que nadie hace.
   */
  ingreso_gs: number;
  /** Fondos que quedan después de los cobros y los pagos de ese día. */
  acumulado_gs: number;
  /** El acumulado llevado a dólares al tipo de cambio del mes. */
  acumulado_usd: number;
}

/** Una cobranza proyectada dentro de una celda. */
export interface CobranzaProyectada {
  cuenta_id: string;
  cliente_nombre: string;
  numero_venta: string | null;
  /** Lo que falta cobrar, no el total de la venta. */
  saldo: number;
  moneda: MonedaFlujo;
  /** `parcial` si ya se cobró una parte. */
  estado: string;
  fecha_vencimiento: string;
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
  /** Las cobranzas que vencen en el mes, por día (clave 1..31). */
  cobranzas: Record<number, CobranzaProyectada[]>;
  /** Suma del mes, sin contar cobrados ni anulados. */
  resumen: {
    total_usd: number;
    total_gs: number;
    egreso_total_gs: number;
    /** Lo que se espera cobrar en el mes, en guaraníes. */
    ingreso_total_gs: number;
    /**
     * Saldos por cobrar que vencieron ANTES del mes y siguen sin cobrarse.
     *
     * NO se suma al Disponible: es plata que ya debería haber entrado y no
     * entró, y meterla en la proyección sería contar como disponible algo que
     * justamente no está. Va aparte, como aviso.
     */
    cobranzas_vencidas_gs: number;
    acumulado_final_gs: number;
  };
  /**
   * Posición de liquidez del mes. Es informativa: la foto sobre la que se apoya
   * el flujo, no un insumo de la proyección de pagos. Los fondos iniciales salen
   * de bancos + efectivo; la mercadería va aparte porque no es plata disponible.
   */
  liquidez: {
    /**
     * De dónde salieron los fondos iniciales: `saldos` (posición de liquidez),
     * `manual` (el monto escrito en la config), `arrastre` (el cierre del mes
     * anterior) o `sin_datos` (no había de dónde sacarlo).
     */
    origen: OrigenFondos;
    /** Si vino arrastrado, de qué mes salió el último monto cargado. */
    arrastre_de?: { anio: number; mes: number };
    total_gs: number;
    mercaderia_gs: number;
    detalle: SaldoLiquidez[];
  };
  /**
   * Para explicar una grilla vacía sin tener que mirar la base: cuántas compras
   * hay, cuántas quedaron afuera y por qué, y en qué meses sí caen los pagos.
   */
  diagnostico: DiagnosticoFlujo;
}

export interface DiagnosticoFlujo {
  /** Compras no anuladas de la empresa, contadas por factura. */
  compras_total: number;
  /** De esas, cuántas son a crédito (las únicas que se proyectan). */
  compras_credito: number;
  /** A crédito pero con fecha de pago fuera del mes que se está mirando. */
  fuera_del_mes: number;
  /** Meses donde sí hay pagos a crédito, con cuántos en cada uno. */
  meses_con_pagos: { anio: number; mes: number; cantidad: number }[];
}

export type TipoSaldo = "banco" | "efectivo" | "mercaderia";

/** Una línea de la posición de liquidez: una cuenta, la caja o el stock. */
export interface SaldoLiquidez {
  tipo: TipoSaldo;
  /** Nombre del banco, "Caja central", "Depósito"… */
  descripcion: string;
  moneda: MonedaFlujo;
  importe: number;
}
