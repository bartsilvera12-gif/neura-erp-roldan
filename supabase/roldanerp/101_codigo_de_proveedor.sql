-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 101 · Código de proveedor
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: «ponele el código de proveedor también al listado».
--   No existía: se crea el campo. Es texto libre (el código que usan ellos),
--   opcional, y no se repite dentro de la empresa.
--
-- QUÉ HACE
--   1. Agrega `proveedores.codigo` (texto, puede quedar vacío).
--   2. Índice único por empresa sobre el código, solo para los que tienen uno.
--
-- Hasta que este script corra, la pantalla funciona igual: el campo no
-- aparece para cargar y el listado no muestra la columna.
-- Idempotente.
-- ============================================================================

ALTER TABLE roldanerp.proveedores ADD COLUMN IF NOT EXISTS codigo text;

CREATE UNIQUE INDEX IF NOT EXISTS proveedores_empresa_codigo_uniq
  ON roldanerp.proveedores (empresa_id, upper(btrim(codigo)))
  WHERE codigo IS NOT NULL AND btrim(codigo) <> '';

NOTIFY pgrst, 'reload schema';
