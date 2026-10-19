/**
 * Tipos del reporte de Ganancias (P&L simplificado) — Roldán e Hijos.
 *
 * Criterios (confirmados con el cliente):
 *  - Ventas NETAS (sin IVA = subtotal) como base del margen; el total con IVA
 *    se muestra sólo como dato informativo.
 *  - CMV = costo REAL de la mercadería vendida (no todas las compras): se toma
 *    del `costo_unitario × cantidad` de los movimientos SALIDA (origen 'venta'),
 *    atados a ventas NO anuladas.
 *  - Gastos operativos = SUM(monto) de la tabla `gastos` en el período.
 *  - Comparación contra el período anterior (semana o mes calendario).
 */

export interface GananciasPeriodo {
  /** Ventas sin IVA (SUM subtotal), base del margen. */
  ventasNetas: number;
  /** Ventas con IVA (SUM total), informativo. */
  ventasTotales: number;
  /** Costo de la mercadería vendida (real, no compras). */
  cmv: number;
  /** Ventas netas − CMV. */
  gananciaBruta: number;
  /** Ganancia bruta / ventas netas · 100. */
  margenBruto: number;
  /** Gastos operativos del período. */
  gastos: number;
  /** Ganancia bruta − gastos operativos. */
  gananciaNeta: number;
  /** Ganancia neta / ventas netas · 100. */
  margenNeto: number;
  /** Cantidad de ventas (no anuladas) en el período. */
  cantidadVentas: number;
}

import type { TipoPeriodo } from "./periodos";

/** Unidad de negocio del P&L. */
export type Segmento = "nutricion" | "consignataria" | "consolidado";

export interface GananciasReporte {
  tipo: TipoPeriodo;
  segmento: Segmento;
  /** Referencia de navegación del período (formato depende del tipo). */
  ref: string;
  /** Etiqueta legible del período actual (ej. "Agosto 2026" / "11–17 ago 2026"). */
  periodoLabel: string;
  /** Etiqueta legible del período anterior. */
  anteriorLabel: string;
  actual: GananciasPeriodo;
  anterior: GananciasPeriodo;
}
