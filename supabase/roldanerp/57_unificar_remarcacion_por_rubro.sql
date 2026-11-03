-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 57 · Poner a todos los productos la remarcación de su rubro padre
-- ============================================================================
--
-- ⚠ ESTE SCRIPT CAMBIA PRECIOS DE VENTA. Leer entero antes de correrlo.
--
-- ── QUÉ HACE ──────────────────────────────────────────────────────────────
--   A cada producto cuyo rubro cuelga de un rubro padre le pone la remarcación
--   del PADRE, y le recalcula el precio de venta:
--
--       precio_venta = costo_promedio × (1 + remarcacion_del_padre / 100)
--
--   Es el "camino B": una sola remarcación por rubro, para todos sus grupos.
--
-- ── LO QUE HAY QUE SABER ANTES ────────────────────────────────────────────
--   Medido sobre la base real al escribir esto: cambian 192 productos y la
--   suma de los precios de lista BAJA Gs. 3.202.046. Casi todos bajan, y no es
--   casualidad: la remarcación del rubro es la tarifa base, y los productos
--   que difieren son los que alguien remarcó MÁS ARRIBA a propósito, uno por
--   uno. Dentro de CHAPA NEGRA conviven 10%, 20%, 29,94%, 35,43% y 35,77%.
--
--   Correr esto borra esas decisiones. Si eso no es lo que se quiere, no se
--   corre: el script 56 ya dejó el árbol y la remarcación de referencia del
--   grupo, que es lo que toman los productos NUEVOS, sin tocar lo viejo.
--
-- ── SE PUEDE DESHACER ─────────────────────────────────────────────────────
--   Antes de tocar nada guarda el precio y la remarcación anteriores de cada
--   producto en `productos_precio_backup_57`. Al final de este archivo está el
--   UPDATE que los devuelve.
--
-- ── QUÉ NO TOCA ───────────────────────────────────────────────────────────
--   - Los productos sin costo cargado: sin costo no hay de dónde sacar el
--     precio, y poner cero sería regalar la mercadería.
--   - Los productos SIN remarcación cargada (0 o vacía): esos tienen el precio
--     puesto a mano, no derivado del costo. Recalcularlos no corrige nada, les
--     inventa un precio. Son los que hacían subir el total Gs. 7,3 millones en
--     la primera prueba.
--   - Los productos de rubros que no cuelgan de ningún padre (FERRETERIA,
--     PINTURAS, etc.): no tienen grupo con el cual unificarse.
--   - El histórico. Las ventas ya hechas guardan su propio precio.
--
-- Idempotente: la segunda corrida no encuentra nada que cambiar.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

CREATE TABLE IF NOT EXISTS roldanerp.productos_precio_backup_57 (
  producto_id        uuid PRIMARY KEY,
  sku                text,
  nombre             text,
  rubro              text,
  markup_pct_antes   numeric,
  precio_venta_antes numeric,
  markup_pct_despues numeric,
  precio_venta_despues numeric,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.productos_precio_backup_57 IS
  'Precio y remarcacion que tenia cada producto ANTES del script 57. Sirve para volver atras.';

-- ---------------------------------------------------------------------------
-- Qué va a cambiar (se guarda primero)
-- ---------------------------------------------------------------------------
WITH objetivo AS (
  SELECT pr.id                AS producto_id,
         pr.sku,
         pr.nombre,
         hijo.nombre          AS rubro,
         pr.markup_pct        AS markup_antes,
         pr.precio_venta      AS precio_antes,
         padre.markup_pct     AS markup_nuevo,
         round(pr.costo_promedio * (1 + padre.markup_pct / 100.0), 2) AS precio_nuevo
    FROM roldanerp.productos pr
    JOIN roldanerp.categorias_productos hijo  ON hijo.id  = pr.categoria_principal_id
    JOIN roldanerp.categorias_productos padre ON padre.id = hijo.parent_id
   WHERE padre.markup_pct IS NOT NULL
     AND pr.costo_promedio IS NOT NULL
     AND pr.costo_promedio > 0
     -- Solo los que hoy tienen otra remarcación. El que ya coincide no se toca.
     AND (pr.markup_pct IS DISTINCT FROM padre.markup_pct)
     -- Y SOLO los que tienen una remarcación cargada.
     --   El producto con `markup_pct` en 0 o vacío tiene el precio puesto A
     --   MANO, no derivado del costo. Recalcularlo desde la remarcación del
     --   grupo no "corrige" nada: le inventa un precio nuevo. En la prueba
     --   contra los 1.002 productos reales, sin esta condición se tocaban 236
     --   productos y el precio de lista SUBÍA Gs. 7.308.590, casi todo por
     --   CHAPA EXPANDIDA y CHAPA TRASLUCIDA, que tienen el precio cargado
     --   directo. Con ella son 192 y baja Gs. 3.202.046, que es lo que se
     --   quiso: unificar lo que se rige por remarcación.
     AND pr.markup_pct IS NOT NULL
     AND pr.markup_pct > 0
)
INSERT INTO roldanerp.productos_precio_backup_57
  (producto_id, sku, nombre, rubro, markup_pct_antes, precio_venta_antes,
   markup_pct_despues, precio_venta_despues)
SELECT producto_id, sku, nombre, rubro, markup_antes, precio_antes,
       markup_nuevo, precio_nuevo
  FROM objetivo
ON CONFLICT (producto_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- El cambio
-- ---------------------------------------------------------------------------
UPDATE roldanerp.productos pr
   SET markup_pct   = padre.markup_pct,
       precio_venta = round(pr.costo_promedio * (1 + padre.markup_pct / 100.0), 2),
       updated_at   = now()
  FROM roldanerp.categorias_productos hijo,
       roldanerp.categorias_productos padre
 WHERE hijo.id  = pr.categoria_principal_id
   AND padre.id = hijo.parent_id
   AND padre.markup_pct IS NOT NULL
   AND pr.costo_promedio IS NOT NULL
   AND pr.costo_promedio > 0
   AND (pr.markup_pct IS DISTINCT FROM padre.markup_pct)
   -- Ver el comentario de arriba: el precio puesto a mano no se recalcula.
   AND pr.markup_pct IS NOT NULL
   AND pr.markup_pct > 0;

COMMIT;

-- ---------------------------------------------------------------------------
-- Qué pasó
-- ---------------------------------------------------------------------------
DO $resumen$
DECLARE
  v_n int; v_antes numeric; v_despues numeric; v_pend int; r record;
BEGIN
  SELECT count(*), coalesce(sum(precio_venta_antes), 0), coalesce(sum(precio_venta_despues), 0)
    INTO v_n, v_antes, v_despues
    FROM roldanerp.productos_precio_backup_57;

  -- Cuántos quedan por unificar HOY. En una segunda corrida esto da cero, y
  -- así se ve que el resumen de abajo es el historico del respaldo y no algo
  -- que haya vuelto a pasar.
  SELECT count(*) INTO v_pend
    FROM roldanerp.productos pr
    JOIN roldanerp.categorias_productos hijo  ON hijo.id  = pr.categoria_principal_id
    JOIN roldanerp.categorias_productos padre ON padre.id = hijo.parent_id
   WHERE padre.markup_pct IS NOT NULL
     AND pr.costo_promedio > 0
     AND pr.markup_pct > 0
     AND pr.markup_pct IS DISTINCT FROM padre.markup_pct;

  RAISE NOTICE '';
  IF v_pend = 0 THEN
    RAISE NOTICE 'No queda ningun producto por unificar.';
  ELSE
    RAISE NOTICE 'ATENCION: quedan % productos sin unificar.', v_pend;
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE 'Acumulado en el respaldo (todo lo que este script cambio alguna vez):';
  RAISE NOTICE 'Productos con la remarcacion unificada: %', v_n;
  RAISE NOTICE 'Precio de lista sumado: antes % -> despues % (dif %)',
    round(v_antes), round(v_despues), round(v_despues - v_antes);
  RAISE NOTICE '';
  RAISE NOTICE 'POR RUBRO:';
  FOR r IN
    SELECT rubro,
           count(*) AS n,
           round(sum(precio_venta_despues - precio_venta_antes)) AS dif
      FROM roldanerp.productos_precio_backup_57
     GROUP BY rubro ORDER BY abs(sum(precio_venta_despues - precio_venta_antes)) DESC
  LOOP
    RAISE NOTICE '  % : % productos, %', r.rubro, r.n, r.dif;
  END LOOP;
  RAISE NOTICE '';
  RAISE NOTICE 'Para volver atras, ver el UPDATE comentado al final del script.';
END
$resumen$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PARA VOLVER ATRAS
-- ============================================================================
-- Descomentar y correr. Devuelve a cada producto el precio y la remarcacion
-- que tenia, y vacia el respaldo.
--
-- BEGIN;
-- UPDATE roldanerp.productos pr
--    SET markup_pct   = b.markup_pct_antes,
--        precio_venta = b.precio_venta_antes,
--        updated_at   = now()
--   FROM roldanerp.productos_precio_backup_57 b
--  WHERE b.producto_id = pr.id;
-- DELETE FROM roldanerp.productos_precio_backup_57;
-- COMMIT;
