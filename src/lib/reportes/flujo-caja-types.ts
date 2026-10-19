import type { TipoPeriodo } from "./periodos";

export interface MovimientoCaja {
  fecha: string;
  /** "Venta contado" | "Cobro" | "Pago compra" | "Gasto" */
  tipo: string;
  referencia: string | null;
  descripcion: string | null;
  metodo: string | null;
  entrada: number;
  salida: number;
}

export interface FlujoCajaReporte {
  tipo: TipoPeriodo;
  ref: string;
  periodoLabel: string;
  /** Acumulado del sistema (entradas − salidas) antes del inicio del período. */
  saldoInicial: number;
  /** Ventas al contado cobradas en el período. */
  entradaContado: number;
  /** Cobros de cuentas a crédito en el período. */
  entradaCobros: number;
  /** Pagos a proveedores (compras marcadas pagadas) en el período. */
  salidaCompras: number;
  /** Gastos del período. */
  salidaGastos: number;
  totalEntradas: number;
  totalSalidas: number;
  /** saldoInicial + totalEntradas − totalSalidas. */
  saldoFinal: number;
  movimientos: MovimientoCaja[];
}
