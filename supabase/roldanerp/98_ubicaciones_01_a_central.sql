-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 98 · Sacar las ubicaciones «01» y pasar todo a Central
-- ============================================================================
--
-- POR QUÉ
--   Pedido del cliente: «borrar las ubicaciones 01 y que vaya todo a
--   Central». Hay ubicaciones (depósitos) que se llaman o tienen código «01»
--   y no se usan como depósito real; la mercadería que figura en ellas está
--   en Central.
--
-- QUÉ HACE, POR EMPRESA
--   1. Busca la ubicación Central (nombre que contiene «central», activa). Si
--      no hay exactamente una, se detiene sin tocar nada.
--   2. Busca las ubicaciones «01» (nombre o código «01», distintas de Central).
--   3. Respalda en `respaldo_98_stock_ubicacion` el stock que tenían.
--   4. Suma ese stock al de Central, producto por producto, y borra las filas
--      de las «01» en `inventario_stock_ubicacion`.
--   5. Los productos cuya ubicación principal era una «01» pasan a Central.
--   6. Los precios propios de una «01» se borran (Central conserva los suyos).
--   7. Las ubicaciones «01» quedan INACTIVAS (no se borran: las ventas, las
--      compras y los movimientos viejos las nombran y el historial no se
--      reescribe). Dejan de aparecer para elegir.
--
-- No toca `productos.stock_actual` (el total no cambia: solo cambia dónde
-- figura). Idempotente: una segunda corrida no encuentra nada que mover.
--
-- Para mirar antes qué se va a mover, correr solo esta consulta:
--   SELECT id, nombre, codigo, activo FROM roldanerp.inventario_ubicaciones
--    WHERE btrim(nombre) = '01' OR btrim(coalesce(codigo,'')) = '01' OR nombre ILIKE '%central%';
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS roldanerp.respaldo_98_stock_ubicacion AS
  SELECT su.*, now() AS respaldado_at
    FROM roldanerp.inventario_stock_ubicacion su
   WHERE false;

DO $mover$
DECLARE
  emp      uuid;
  central  uuid;
  n_central int;
  ids      uuid[];
  movidas  int;
  prods    int;
BEGIN
  FOR emp IN SELECT DISTINCT empresa_id FROM roldanerp.inventario_ubicaciones LOOP
    SELECT count(*), min(id::text)::uuid INTO n_central, central
      FROM roldanerp.inventario_ubicaciones
     WHERE empresa_id = emp AND nombre ILIKE '%central%' AND activo IS TRUE;
    IF n_central <> 1 THEN
      RAISE NOTICE 'Empresa %: hay % ubicaciones «central» activas; no se toca nada.', emp, n_central;
      CONTINUE;
    END IF;

    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO ids
      FROM roldanerp.inventario_ubicaciones
     WHERE empresa_id = emp AND id <> central
       AND (btrim(nombre) = '01' OR btrim(coalesce(codigo, '')) = '01');
    IF array_length(ids, 1) IS NULL THEN
      RAISE NOTICE 'Empresa %: no hay ubicaciones «01».', emp;
      CONTINUE;
    END IF;

    INSERT INTO roldanerp.respaldo_98_stock_ubicacion
      SELECT su.*, now() FROM roldanerp.inventario_stock_ubicacion su
       WHERE su.empresa_id = emp AND su.ubicacion_id = ANY (ids);

    -- Sumar a Central lo que haya en las «01».
    UPDATE roldanerp.inventario_stock_ubicacion c
       SET stock_actual = coalesce(c.stock_actual, 0) + x.stock
      FROM (
        SELECT producto_id, sum(coalesce(stock_actual, 0)) AS stock
          FROM roldanerp.inventario_stock_ubicacion
         WHERE empresa_id = emp AND ubicacion_id = ANY (ids)
         GROUP BY producto_id
      ) x
     WHERE c.empresa_id = emp AND c.ubicacion_id = central AND c.producto_id = x.producto_id;

    INSERT INTO roldanerp.inventario_stock_ubicacion (empresa_id, producto_id, ubicacion_id, stock_actual, es_principal)
    SELECT emp, x.producto_id, central, x.stock, true
      FROM (
        SELECT producto_id, sum(coalesce(stock_actual, 0)) AS stock
          FROM roldanerp.inventario_stock_ubicacion
         WHERE empresa_id = emp AND ubicacion_id = ANY (ids)
         GROUP BY producto_id
      ) x
     WHERE NOT EXISTS (
       SELECT 1 FROM roldanerp.inventario_stock_ubicacion c
        WHERE c.empresa_id = emp AND c.ubicacion_id = central AND c.producto_id = x.producto_id
     );

    DELETE FROM roldanerp.inventario_stock_ubicacion
     WHERE empresa_id = emp AND ubicacion_id = ANY (ids);
    GET DIAGNOSTICS movidas = ROW_COUNT;

    UPDATE roldanerp.productos SET ubicacion_principal_id = central, updated_at = now()
     WHERE empresa_id = emp AND ubicacion_principal_id = ANY (ids);
    GET DIAGNOSTICS prods = ROW_COUNT;

    IF to_regclass('roldanerp.producto_precios_deposito') IS NOT NULL THEN
      DELETE FROM roldanerp.producto_precios_deposito WHERE empresa_id = emp AND ubicacion_id = ANY (ids);
    END IF;

    UPDATE roldanerp.inventario_ubicaciones SET activo = false
     WHERE empresa_id = emp AND id = ANY (ids);

    RAISE NOTICE 'Empresa %: % ubicaciones «01» inactivas; % filas de stock pasadas a Central; % productos con Central como principal.',
      emp, array_length(ids, 1), movidas, prods;
  END LOOP;
END
$mover$;

COMMIT;
