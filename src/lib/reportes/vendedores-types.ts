import type { TipoPeriodo } from "./periodos";

/**
 * Qué vende cada vendedor.
 *
 * ── POR QUÉ ES UN REPORTE APARTE Y NO UN FILTRO DE RENTABILIDAD ───────────
 *   Rentabilidad contesta "qué producto deja más plata". Esto contesta otra
 *   pregunta: "qué vende Fulano". Son parecidas y no son la misma: el que
 *   vende más facturación puede estar vendiendo lo que menos margen deja, y
 *   eso recién se ve cuando se mira producto por producto DENTRO de cada
 *   vendedor. Con un filtro por vendedor sobre Rentabilidad habría que entrar
 *   seis veces y anotar a mano para poder comparar.
 *
 * Los números son los mismos que usa Rentabilidad —facturación sin IVA y
 * costo de lo vendido sin IVA— justamente para que los dos reportes no digan
 * cosas distintas del mismo mes.
 */

/** Cómo se agrupa lo que vendió cada vendedor. */
export type AgruparVendedor = "producto" | "categoria";

/** Una línea de lo que vendió un vendedor: un producto o un rubro. */
export interface VendedorItemRow {
  /** id del producto o del rubro (o "sin-categoria"). */
  id: string;
  nombre: string;
  sku?: string | null;
  categoria?: string | null;
  unidades: number;
  /** Facturación sin IVA. */
  facturacion: number;
  /** Costo de lo vendido, sin IVA. */
  costo: number;
  /** facturacion − costo. */
  utilidad: number;
  /** utilidad / facturacion · 100. */
  margen: number;
  /** facturacion / facturacion_del_vendedor · 100: cuánto pesa en SU venta. */
  participacion: number;
}

/** Totales de un vendedor en el período. */
export interface VendedorRow {
  /**
   * `vendedor_usuario_id` de la venta; si la venta no tiene vendedor cargado,
   * cae al usuario que la hizo (el cajero), y si no hay ninguno de los dos,
   * "sin-vendedor".
   */
  id: string;
  nombre: string;
  /** Cantidad de ventas (comprobantes), no de líneas. */
  ventas: number;
  unidades: number;
  facturacion: number;
  costo: number;
  utilidad: number;
  margen: number;
  /** facturacion / facturacion_total · 100. */
  participacion: number;
  /** facturacion / ventas. */
  ticketPromedio: number;
  /** Lo que más vende, para la tarjeta. Vacío si no vendió nada. */
  top: VendedorItemRow[];
}

export interface VendedoresReporte {
  tipo: TipoPeriodo;
  agrupar: AgruparVendedor;
  ref: string;
  periodoLabel: string;
  totalFacturacion: number;
  totalCosto: number;
  totalUtilidad: number;
  totalVentas: number;
  vendedores: VendedorRow[];
  /**
   * Detalle completo del vendedor pedido (`?vendedor=`). Null cuando no se
   * pidió ninguno: traer todo de todos no lo mira nadie y pesa de más.
   */
  detalle: { vendedorId: string; nombre: string; filas: VendedorItemRow[] } | null;
}
