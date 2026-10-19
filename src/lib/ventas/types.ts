export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
export type MetodoPago  = "efectivo" | "tarjeta" | "transferencia" | "cheque";
export type EstadoVenta = "pendiente" | "completada" | "anulada";
/** Nivel de precio elegido para la línea de venta.
 *  'costo' se conserva SOLO como histórico (ventas viejas); ya no se ofrece en la UI. */
export type TipoPrecioVenta = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  cantidad:              number;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS
  tipo_iva:              TipoIvaVenta;
  /** Nivel de precio aplicado: minorista (precio_venta) | mayorista (precio_mayorista) | costo (costo_promedio). */
  tipo_precio?:          TipoPrecioVenta;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
  /** Nombre de la categoría de cliente cuyo precio se está aplicando en esta
   *  línea (C1, C2, C3, C4). null cuando el precio es el base del producto. */
  categoria_aplicada?:   string | null;
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  metodo_pago?: MetodoPago;  // Neura ERP Roldán e Hijos: efectivo/tarjeta/transferencia

  /** La venta emite nota de remisión (documento no fiscal). */
  genera_nota_remision?: boolean;
  /** Número de nota de remisión (NR-XXXXXX) si genera_nota_remision. */
  nota_remision_numero?: string | null;

  fecha: string;             // ISO string, generado automáticamente

  estado?: EstadoVenta;
  anulada_at?: string | null;
  anulacion_motivo?: string | null;

  /** Cliente asociado a la venta. null cuando la venta fue a consumidor final sin ficha. */
  cliente_id?: string | null;
  /** Nombre para mostrar en listados de Caja (prioriza nombre_facturacion → empresa
   *  → nombre_contacto → nombre). null cuando no hay cliente. */
  cliente_nombre?: string | null;
  /** Nombre comercial / sucursal / local del cliente (para diferenciar sucursales
   *  en la lista). null cuando el cliente no tiene uno cargado. */
  cliente_sucursal?: string | null;
  /** Factura ERP asociada (puente venta→factura). null si la venta no emitió factura. */
  factura_id?: string | null;
  numero_factura?: string | null;
  /** Estado SIFEN de la factura electrónica: borrador | generado | firmado |
   *  enviado | en_proceso | aprobado | rechazado | error_envio | cancelado.
   *  El UI usa este dato para permitir anular la venta cuando el DE nunca
   *  llegó a SET (estados no-aceptados). null si no hay factura. */
  factura_estado_sifen?: string | null;
  /** Unidad de negocio de la venta: 'consignacion' = Consignataria; el resto
   *  (normal/MANUAL/presupuesto/null) = Nutrición. Se usa para el filtro de Caja. */
  origen?: string | null;
}
