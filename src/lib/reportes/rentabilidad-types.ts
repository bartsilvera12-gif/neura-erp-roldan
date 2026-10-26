import type { TipoPeriodo } from "./periodos";

/** Cómo se agrupan las filas de rentabilidad. */
export type AgruparRentabilidad = "producto" | "categoria";

export interface RentabilidadRow {
  /** id del producto o del rubro (o "sin-categoria"). */
  id: string;
  nombre: string;
  /** SKU (solo cuando se agrupa por producto). */
  sku?: string | null;
  /** Rubro del producto (solo cuando se agrupa por producto). */
  categoria?: string | null;
  unidades: number;
  /** Facturación sin IVA (subtotal de las líneas vendidas). */
  facturacion: number;
  /** Costo de lo vendido, sin IVA. */
  costo: number;
  /** facturacion − costo. */
  ganancia: number;
  /** ganancia / facturacion · 100. */
  margen: number;
  /** ganancia / ganancia_total · 100 (participación en la utilidad). */
  participacion: number;
}

export interface RentabilidadReporte {
  tipo: TipoPeriodo;
  agrupar: AgruparRentabilidad;
  ref: string;
  periodoLabel: string;
  /** Totales del período (para el pie / KPIs). */
  totalFacturacion: number;
  totalCosto: number;
  totalGanancia: number;
  filas: RentabilidadRow[];
}
