DROP SCHEMA IF EXISTS roldanerp CASCADE;
CREATE SCHEMA roldanerp;

CREATE TABLE roldanerp.ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL, sucursal_id uuid NOT NULL,
  numero_control text, estado text DEFAULT 'completada',
  subtotal numeric, monto_iva numeric, total numeric,
  cliente_id uuid, tipo_venta text, metodo_pago text, plazo_dias int,
  factura_id uuid, fecha timestamptz DEFAULT now(), updated_at timestamptz
);
CREATE TABLE roldanerp.ventas_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL, venta_id uuid NOT NULL REFERENCES roldanerp.ventas(id),
  producto_id uuid, producto_nombre text, sku text,
  cantidad numeric, precio_venta numeric, precio_venta_original numeric,
  tipo_iva text, subtotal numeric, monto_iva numeric, total_linea numeric,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE roldanerp.productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL, sucursal_id uuid NOT NULL,
  nombre text, sku text, stock_actual numeric DEFAULT 0,
  costo_promedio numeric DEFAULT 0, controla_stock boolean DEFAULT true,
  updated_at timestamptz
);
CREATE TABLE roldanerp.movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid, sucursal_id uuid, producto_id uuid,
  producto_nombre text, producto_sku text, tipo text, cantidad numeric,
  costo_unitario numeric, origen text, referencia text, fecha timestamptz,
  created_by uuid, usuario_nombre text, venta_id uuid, created_at timestamptz DEFAULT now(),
  CONSTRAINT movimientos_inventario_origen_check CHECK (origen = ANY (ARRAY[
    'compra','venta','ajuste_manual','inventario_inicial','anulacion_venta',
    'anulacion_compra','produccion','transferencia_salida','transferencia_entrada']))
);

-- Datos: dos productos y una venta de ejemplo
INSERT INTO roldanerp.productos (id, empresa_id, sucursal_id, nombre, sku, stock_actual, costo_promedio) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','TORNILLO','TOR-1', 100, 1000),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','CHAPA','CHA-1', 3, 50000);

INSERT INTO roldanerp.ventas (id, empresa_id, sucursal_id, numero_control, subtotal, monto_iva, total, tipo_venta, metodo_pago)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','VTA-000001', 90909, 9091, 100000, 'CONTADO','efectivo');

INSERT INTO roldanerp.ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta, precio_venta_original, tipo_iva, subtotal, monto_iva, total_linea)
VALUES ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','TORNILLO','TOR-1', 10, 10000, 10000, '10%', 90909, 9091, 100000);

-- La venta ya descontó su stock
UPDATE roldanerp.productos SET stock_actual = stock_actual - 10 WHERE sku = 'TOR-1';
