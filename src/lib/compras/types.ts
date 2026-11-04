export type TipoPago = "contado" | "credito";
export type TipoIva = "exenta" | "5" | "10";
export type Moneda = "PYG" | "USD";
/** Método de pago (cómo se pagó). Distinto a TipoPago (contado/crédito, plazo). */
/**
 * Los medios con los que se paga una compra.
 *
 * La lista viva es `MEDIOS_PAGO_COMPRA`, en `pago-caja.ts`, que además dice
 * cuál de ellos baja el efectivo esperado del arqueo (solo el efectivo).
 * Este alias existe para no romper lo que ya lo importa de acá.
 */
export type MetodoPago = "efectivo" | "transferencia" | "tarjeta" | "cheque";

export interface Compra {
  id: string;
  numero_control: string;        // COMP-000001, COMP-000002, ...

  proveedor_id: string;
  proveedor_nombre: string;

  producto_id: string;
  producto_nombre: string;

  cantidad: number;

  moneda: Moneda;
  tipo_cambio: number;           // 1 si PYG; cotización si USD
  costo_unitario_original: number; // en la moneda elegida
  costo_unitario: number;        // siempre en PYG (para impacto en inventario)

  iva_tipo: TipoIva;
  subtotal: number;              // PYG, antes de IVA
  monto_iva: number;             // PYG
  total: number;                 // PYG, total con IVA

  precio_venta: number;          // PYG, precio de venta sugerido
  margen_venta: number;          // % margen sobre venta

  tipo_pago: TipoPago;
  plazo_dias?: number;           // solo si tipo_pago === "credito"

  nro_timbrado: string;

  // Comprobante/factura del proveedor (compartido por todas las líneas del numero_control).
  comprobante_storage_path?: string | null;
  comprobante_nombre?: string | null;
  comprobante_mime_type?: string | null;

  fecha: string;                 // ISO string, generado automáticamente

  /** Fecha del comprobante fiscal del proveedor (YYYY-MM-DD). Distinta a `fecha`
   *  (que es la fecha de registro en el sistema). Nullable — puede cargarse
   *  después o quedar vacío en compras históricas. */
  fecha_factura?: string | null;
  /** Cómo se pagó: efectivo / transferencia / tarjeta. Distinto al tipo_pago
   *  (contado/crédito) que define plazo. Nullable en compras históricas. */
  metodo_pago?: MetodoPago | null;

  estado?: "registrada" | "pendiente" | "pagada" | "anulada";
  anulada_at?: string | null;
  anulacion_motivo?: string | null;
}
