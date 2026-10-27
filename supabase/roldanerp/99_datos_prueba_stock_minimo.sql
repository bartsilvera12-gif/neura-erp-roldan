-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 99 · DATOS DE PRUEBA — ventas de meses anteriores
-- ============================================================================
--
-- ⚠ ESTO ESCRIBE VENTAS FALSAS EN LA BASE DE PRODUCCIÓN. LEER ANTES.
--
--   Sirve para probar el stock mínimo automático (1.2) y la reposición, que
--   necesitan seis meses de historia y hoy no la hay.
--
--   Mientras estén cargadas, estas ventas aparecen en los informes como si
--   fueran reales: Ventas, Utilidad por período, Libro de Ventas, Comisiones
--   y Flujo de caja van a incluirlas. No sirven para evaluar el negocio.
--
--   Todo queda marcado con `numero_control` que empieza en 'SIM-' y con la
--   observación 'DATOS DE PRUEBA'. Al final del archivo está el borrado, que
--   los saca por esa marca sin tocar nada real.
--
--   SE RECOMIENDA: correrlo, probar, y borrarlo el mismo día.
--
-- ── QUÉ GENERA Y POR QUÉ ASÍ ──────────────────────────────────────────────
--   Seis meses cerrados hacia atrás, con cuatro patrones distintos repartidos
--   entre los productos que controlan stock. Los patrones están elegidos para
--   que se vea el comportamiento que importa:
--
--     patrón 1 · PAREJO      12, 10, 14, 11, 13, 12  → mediana ~12
--     patrón 2 · CON PICO      3,  2, 90,  2,  3,  2  → mediana 3, pico 90
--     patrón 3 · DE A RATOS    0,  0, 40,  0,  0, 25  → mediana 0
--     patrón 4 · POCO Y FIJO   1,  2,  1,  2,  1,  2  → mediana ~1,5
--
--   El patrón 2 es la prueba que vale: el promedio daría 17 y obligaría a
--   tener plata parada en mercadería que no rota; la mediana da 3. El patrón
--   3 muestra por qué los meses sin venta cuentan como cero: es un producto
--   que se mueve de a ratos, no uno de stock permanente.
--
-- ── NO TOCA EL STOCK ──────────────────────────────────────────────────────
--   Se escriben los movimientos de SALIDA que la reposición necesita para
--   calcular el consumo, pero NO se descuenta `productos.stock_actual`:
--   bajarlo dejaría el inventario real mintiendo.
--
--   El efecto de eso es que la Valoración de existencias (1.6) va a mostrar
--   diferencias mientras estos datos estén cargados, porque reconstruye el
--   stock desde los movimientos. Es esperable, y se va al borrarlos.
--
-- Idempotente: si ya se corrió, no duplica (borra lo anterior y rehace).
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.ventas') IS NULL
     OR to_regclass('roldanerp.ventas_items') IS NULL
     OR to_regclass('roldanerp.movimientos_inventario') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas base. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 0) Limpiar una corrida anterior, para poder volver a correrlo
-- ---------------------------------------------------------------------------
DELETE FROM roldanerp.ventas_items
 WHERE venta_id IN (SELECT id FROM roldanerp.ventas WHERE numero_control LIKE 'SIM-%');
DELETE FROM roldanerp.ventas WHERE numero_control LIKE 'SIM-%';
DELETE FROM roldanerp.movimientos_inventario WHERE referencia LIKE 'SIM-%';

-- ---------------------------------------------------------------------------
-- 1) Generar las ventas
-- ---------------------------------------------------------------------------
DO $sim$
DECLARE
  -- Los seis meses CERRADOS anteriores al actual. El mes en curso no entra:
  -- está incompleto y arrastraría la mediana hacia abajo.
  v_mes_actual date := date_trunc('month', (now() - interval '3 hours'))::date;
  r_prod   record;
  v_i      int;
  v_mes    date;
  v_fecha  timestamptz;
  v_cant   numeric;
  v_patron int;
  v_venta  uuid;
  v_num    int := 0;
  v_precio numeric;
  v_sub    numeric;
  v_iva    numeric;
  v_total  numeric;
  v_tasa   numeric;
  -- Las cuatro series, en el orden de los seis meses (del más viejo al más nuevo).
  v_series numeric[][] := ARRAY[
    ARRAY[12, 10, 14, 11, 13, 12],   -- parejo
    ARRAY[ 3,  2, 90,  2,  3,  2],   -- con pico
    ARRAY[ 0,  0, 40,  0,  0, 25],   -- de a ratos
    ARRAY[ 1,  2,  1,  2,  1,  2]    -- poco y fijo
  ];
  v_filas int := 0;
BEGIN
  FOR r_prod IN
    SELECT p.id, p.empresa_id, p.sucursal_id, p.nombre, p.sku,
           COALESCE(NULLIF(p.precio_venta, 0), 10000) AS precio,
           COALESCE(p.costo_promedio, 0) AS costo,
           COALESCE(NULLIF(p.tipo_iva, ''), '10%') AS tipo_iva,
           row_number() OVER (PARTITION BY p.empresa_id ORDER BY p.nombre) AS n
      FROM roldanerp.productos p
     WHERE COALESCE(p.controla_stock, true) = true
       AND COALESCE(p.es_vendible, true) = true
     ORDER BY p.empresa_id, p.nombre
  LOOP
    -- Los productos se reparten entre los cuatro patrones, en orden.
    v_patron := ((r_prod.n - 1) % 4) + 1;
    v_precio := r_prod.precio;
    v_tasa := CASE r_prod.tipo_iva WHEN '5%' THEN 0.05 WHEN 'EXENTA' THEN 0 ELSE 0.10 END;

    FOR v_i IN 1..6 LOOP
      v_cant := v_series[v_patron][v_i];
      CONTINUE WHEN v_cant <= 0;   -- un mes en cero no genera venta

      -- Día 12 del mes a media mañana: una fecha cualquiera dentro del mes,
      -- lejos de los bordes para que el corrimiento horario no la corra de mes.
      v_mes := (v_mes_actual - ((7 - v_i) || ' months')::interval)::date;
      v_fecha := (v_mes + interval '11 days' + interval '10 hours')::timestamptz;

      v_num := v_num + 1;
      v_venta := gen_random_uuid();

      -- Precio IVA incluido, igual que el resto del sistema.
      v_total := round(v_cant * v_precio);
      v_sub   := round(v_total / (1 + v_tasa));
      v_iva   := v_total - v_sub;

      INSERT INTO roldanerp.ventas (
        id, empresa_id, sucursal_id, numero_control, moneda, tipo_cambio,
        subtotal, monto_iva, total, estado, tipo_venta, fecha,
        genera_nota_remision, origen, pendiente_cobro, metodo_pago, observaciones
      ) VALUES (
        v_venta, r_prod.empresa_id, r_prod.sucursal_id,
        'SIM-' || lpad(v_num::text, 6, '0'),
        'GS', 1, v_sub, v_iva, v_total, 'completada', 'CONTADO', v_fecha,
        false, 'normal', false, 'efectivo', 'DATOS DE PRUEBA'
      );

      INSERT INTO roldanerp.ventas_items (
        id, empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
        precio_venta_original, precio_venta, tipo_iva, subtotal, monto_iva,
        total_linea, tipo_precio
      ) VALUES (
        gen_random_uuid(), r_prod.empresa_id, v_venta, r_prod.id,
        r_prod.nombre, COALESCE(r_prod.sku, ''), v_cant,
        v_precio, v_precio, r_prod.tipo_iva, v_sub, v_iva, v_total, 'minorista'
      );

      -- El movimiento de SALIDA es lo que lee la Reposición para el consumo.
      -- No se descuenta el stock a propósito: ver la nota de arriba.
      INSERT INTO roldanerp.movimientos_inventario (
        id, empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
        tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre
      ) VALUES (
        gen_random_uuid(), r_prod.empresa_id, r_prod.sucursal_id, r_prod.id,
        r_prod.nombre, COALESCE(r_prod.sku, ''), 'SALIDA', v_cant,
        r_prod.costo, 'venta', 'SIM-' || lpad(v_num::text, 6, '0'),
        v_fecha, 'DATOS DE PRUEBA'
      );

      v_filas := v_filas + 1;
    END LOOP;
  END LOOP;

  IF v_filas = 0 THEN
    RAISE EXCEPTION 'No se genero nada: no hay productos que controlen stock y sean vendibles.';
  END IF;
  RAISE NOTICE 'Generadas % ventas de prueba sobre los 6 meses cerrados anteriores.', v_filas;
END
$sim$;

-- ---------------------------------------------------------------------------
-- 2) Qué quedó, para controlar contra la pantalla
-- ---------------------------------------------------------------------------
--   Esta consulta calcula la mediana igual que el sistema. Lo que diga acá es
--   lo que tiene que decir la columna "Mínimo" de Inventario → Reposición.
WITH meses AS (
  SELECT generate_series(
           (date_trunc('month', (now() - interval '3 hours')) - interval '6 months')::date,
           (date_trunc('month', (now() - interval '3 hours')) - interval '1 month')::date,
           interval '1 month')::date AS mes
),
vendido AS (
  SELECT vi.producto_id,
         date_trunc('month', (v.fecha - interval '3 hours'))::date AS mes,
         SUM(vi.cantidad)::numeric AS unidades
    FROM roldanerp.ventas_items vi
    JOIN roldanerp.ventas v ON v.id = vi.venta_id
   WHERE v.numero_control LIKE 'SIM-%'
   GROUP BY 1, 2
),
grilla AS (
  SELECT p.producto_id, m.mes, COALESCE(x.unidades, 0) AS unidades
    FROM (SELECT DISTINCT producto_id FROM vendido) p
    CROSS JOIN meses m
    LEFT JOIN vendido x ON x.producto_id = p.producto_id AND x.mes = m.mes
)
SELECT pr.nombre AS producto,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY g.unidades)::numeric(10,2) AS minimo_esperado,
       SUM(g.unidades)::int  AS total_6_meses,
       MAX(g.unidades)::int  AS pico,
       COUNT(*) FILTER (WHERE g.unidades > 0) AS meses_con_venta
  FROM grilla g
  JOIN roldanerp.productos pr ON pr.id = g.producto_id
 GROUP BY pr.nombre
 ORDER BY pr.nombre;

-- ============================================================================
-- BORRAR LOS DATOS DE PRUEBA
-- ============================================================================
-- Correr este bloque cuando termines de probar. Saca solo lo marcado 'SIM-',
-- no toca ninguna venta ni movimiento real.
--
--   DELETE FROM roldanerp.ventas_items
--    WHERE venta_id IN (SELECT id FROM roldanerp.ventas WHERE numero_control LIKE 'SIM-%');
--   DELETE FROM roldanerp.ventas WHERE numero_control LIKE 'SIM-%';
--   DELETE FROM roldanerp.movimientos_inventario WHERE referencia LIKE 'SIM-%';
--
-- Para confirmar que no quedó nada:
--   SELECT count(*) FROM roldanerp.ventas WHERE numero_control LIKE 'SIM-%';
-- ============================================================================
