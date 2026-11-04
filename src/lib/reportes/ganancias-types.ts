/**
 * Tipos del reporte de Ganancias (P&L simplificado) — Roldán e Hijos.
 *
 * Criterios (confirmados con el cliente):
 *  - Ventas NETAS (sin IVA = subtotal) como base del margen; el total con IVA
 *    se muestra sólo como dato informativo.
 *  - CMV = costo REAL de la mercadería vendida (no todas las compras): se toma
 *    del `costo_unitario × cantidad` de los movimientos SALIDA (origen 'venta'),
 *    atados a ventas NO anuladas.
 *  - Gastos operativos = los del módulo de Gastos MÁS los egresos de caja del
 *    período, que es donde esta empresa viene registrando sus gastos de
 *    verdad. Sin los egresos, la ganancia neta era igual a la bruta.
 *    Se excluye el egreso "pago a proveedor": esa plata es el costo de la
 *    mercadería y ya está contada en el CMV.
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
  /** Gastos operativos del período: los del módulo más los egresos de caja. */
  gastos: number;
  /** Solo los cargados en el módulo de Gastos. */
  gastosModulo?: number;
  /** Solo los egresos de caja, sin los pagos a proveedor. */
  egresosCaja?: number;
  /**
   * Los egresos de caja abiertos por tipo (flete, sueldo, servicios…).
   *
   * Una ganancia neta que baja treinta millones sin decir en qué se fue no se
   * puede discutir con nadie.
   */
  egresosPorTipo?: Record<string, number>;
  /** Ganancia bruta − gastos operativos. */
  gananciaNeta: number;
  /** Ganancia neta / ventas netas · 100. */
  margenNeto: number;
  /** Cantidad de ventas (no anuladas) en el período. */
  cantidadVentas: number;
  /**
   * Cuántas de esas ventas NO tienen costo registrado.
   *
   * El CMV sale de los movimientos de inventario de cada venta, y las ventas
   * que vinieron de la migración no los tienen. Con este número en cero, la
   * utilidad bruta es real; con un número grande, está sobrestimada en el
   * costo que falta.
   */
  ventasSinCosto?: number;
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
