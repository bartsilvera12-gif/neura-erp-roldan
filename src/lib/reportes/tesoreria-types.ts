import type { TipoPeriodo } from "./periodos";

export interface TesoreriaRow {
  /** Nombre de la entidad (banco/cuenta/POS) o "Efectivo (caja)". */
  entidad: string;
  /** Entradas cobradas por esa entidad en el período. */
  entradas: number;
  /** Salidas pagadas por esa entidad (0 hasta que compras/gastos guarden entidad). */
  salidas: number;
  /** entradas − salidas. */
  saldoSistema: number;
  /** Entradas bancarias todavía pendientes de conciliar (no aplica a efectivo). */
  pendienteConciliar: number;
  /** Cantidad de movimientos. */
  cantidad: number;
}

export interface TesoreriaReporte {
  tipo: TipoPeriodo;
  ref: string;
  periodoLabel: string;
  totalEntradas: number;
  totalPendienteConciliar: number;
  filas: TesoreriaRow[];
}
