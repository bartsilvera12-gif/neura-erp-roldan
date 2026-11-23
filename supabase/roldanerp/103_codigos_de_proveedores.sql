-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 103 · Asignar código a los proveedores que no tienen
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: «asignales códigos a los proveedores». El campo se
--   creó con el script 101 y estaba vacío.
--
-- QUÉ HACE, POR EMPRESA
--   Numera P0001, P0002, … a los proveedores SIN código, en orden alfabético.
--   Si ya hay códigos P#### cargados, sigue desde el más alto (no repite ni
--   pisa nada). Los que ya tienen código, sea el que sea, quedan como están.
--
-- Requiere el script 101. Idempotente: una segunda corrida no encuentra
-- proveedores sin código y no hace nada.
--
-- Para ver el resultado:
--   SELECT codigo, nombre FROM roldanerp.proveedores ORDER BY codigo;
-- ============================================================================

WITH base AS (
  SELECT empresa_id,
         COALESCE(MAX(substring(upper(btrim(codigo)) FROM '^P(\d+)$')::int), 0) AS ultimo
    FROM roldanerp.proveedores
   GROUP BY empresa_id
),
nuevos AS (
  SELECT p.id,
         b.ultimo + row_number() OVER (PARTITION BY p.empresa_id ORDER BY upper(p.nombre), p.created_at, p.id) AS n
    FROM roldanerp.proveedores p
    JOIN base b ON b.empresa_id = p.empresa_id
   WHERE p.codigo IS NULL OR btrim(p.codigo) = ''
)
UPDATE roldanerp.proveedores p
   SET codigo = 'P' || lpad(nuevos.n::text, 4, '0'),
       updated_at = now()
  FROM nuevos
 WHERE p.id = nuevos.id;
