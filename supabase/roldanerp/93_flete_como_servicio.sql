-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 93 · El FLETE es un servicio, no mercadería
-- ============================================================================
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
--   El FLETE está cargado como mercadería: con stock (240,88 «unidades» del
--   inventario inicial) y con un costo de Gs. 4.496, casi igual a su precio
--   de lista (Gs. 4.500). Como en muchas ventas se cobró menos que eso (en
--   2026 se vendieron 37.810 unidades por Gs. 110 millones, un promedio de
--   Gs. 2.914), los reportes le calculan una utilidad negativa de unos
--   −54 millones y bajan el margen de todo.
--
-- ── LA CORRECCIÓN ──────────────────────────────────────────────────────────
--   El flete no es algo que se compra y se revende: lo que cuesta llevar la
--   mercadería (chofer, combustible, transportista) ya está en Gastos. Con
--   costo de mercadería se estaría restando dos veces.
--
--   Se deja como servicio:
--     - costo_promedio = 0 → los reportes de utilidad no lo cuentan como
--       mercadería (las líneas sin costo quedan fuera de la cuenta);
--     - controla_stock = false → no descuenta stock ni frena una venta o un
--       presupuesto por «falta de stock».
--
--   Antes de cambiar nada se guardan los valores actuales en
--   roldanerp.productos_backup_93, por si hay que volver atrás.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.productos.';
  END IF;
END
$guard$;

-- Respaldo (solo la primera vez).
CREATE TABLE IF NOT EXISTS roldanerp.productos_backup_93 AS
SELECT id, empresa_id, sucursal_id, nombre, sku, costo_promedio, controla_stock, stock_actual, now() AS respaldado_at
  FROM roldanerp.productos
 WHERE upper(trim(nombre)) = 'FLETE';

UPDATE roldanerp.productos
   SET costo_promedio = 0,
       controla_stock = false,
       updated_at = now()
 WHERE upper(trim(nombre)) = 'FLETE'
   AND (costo_promedio IS DISTINCT FROM 0 OR controla_stock IS DISTINCT FROM false);

-- Para volver atrás:
--   UPDATE roldanerp.productos p
--      SET costo_promedio = b.costo_promedio, controla_stock = b.controla_stock
--     FROM roldanerp.productos_backup_93 b
--    WHERE b.id = p.id;

NOTIFY pgrst, 'reload schema';

SELECT nombre, sku, costo_promedio, controla_stock, stock_actual
  FROM roldanerp.productos
 WHERE upper(trim(nombre)) = 'FLETE';
