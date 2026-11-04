-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 53 · Saca los datos de prueba, después de la migración
-- ============================================================================
--
-- ⚠ ESTE SCRIPT BORRA. Leer antes de correr.
--
-- ── QUÉ BORRA ─────────────────────────────────────────────────────────────
--   Lo que se cargó probando el sistema, antes de que existieran los datos
--   reales del cliente:
--
--      46 ventas (VTA-* y SIM-*) con sus ítems y movimientos
--      13 turnos de caja de prueba, con sus movimientos
--       9 compras (COMP-*)
--       2 cheques de esas compras, con su imputación
--       6 productos (QA-*, PRU-*, REV-*) con su stock
--       6 clientes de prueba
--       9 rubros de prueba (A, B, C, D, PRUEBA, EJEMPLO…)
--       8 categorías de cliente de prueba
--       1 anticipo de prueba
--
-- ── CÓMO DISTINGUE PRUEBA DE REAL ─────────────────────────────────────────
--   Por la MARCA DE MIGRACIÓN, no por el nombre. Todo lo que vino del sistema
--   anterior la lleva: las ventas arrancan con HIS-, las compras con HCO-, los
--   clientes la tienen en `notas`, los rubros en `descripcion`, los turnos en
--   `observacion_apertura`.
--
--   No se borra por nombre ("PRUEBA", "QA") a propósito: un cliente real puede
--   llamarse así, y el criterio quedaría dependiendo de cómo alguien bautizó
--   una fila. La ausencia de la marca es un criterio que no se puede
--   confundir.
--
--   CONSECUENCIA QUE HAY QUE SABER: si después de la migración alguien cargó
--   una venta o un cliente REAL a mano, tampoco tiene la marca y este script
--   lo borraría. Si pasó algo así desde hoy, avisá antes de correrlo.
--
-- ── IDEMPOTENTE ───────────────────────────────────────────────────────────
--   Se puede correr dos veces: la segunda no encuentra nada y no hace nada.
--   Cada paso informa cuántas filas sacó.
-- ============================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $limpieza$
DECLARE
  v_ventas uuid[];
  v_cajas uuid[];
  v_prods uuid[];
  v_chq uuid[];
  n int;
BEGIN
  -- ── Las ventas de prueba y todo lo que cuelga de ellas ────────────────
  SELECT array_agg(id) INTO v_ventas
    FROM roldanerp.ventas
   WHERE numero_control IS NULL OR numero_control NOT LIKE 'HIS-%';

  IF v_ventas IS NOT NULL THEN
    DELETE FROM roldanerp.ventas_items WHERE venta_id = ANY(v_ventas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'ventas_items: %', n;

    DELETE FROM roldanerp.ventas_pagos_detalle WHERE venta_id = ANY(v_ventas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'ventas_pagos_detalle: %', n;

    DELETE FROM roldanerp.movimientos_inventario WHERE venta_id = ANY(v_ventas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'movimientos de esas ventas: %', n;

    -- Las cuentas por cobrar de las ventas a crédito de prueba.
    DELETE FROM roldanerp.cuentas_por_cobrar WHERE venta_id = ANY(v_ventas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'cuentas por cobrar: %', n;

    DELETE FROM roldanerp.ventas WHERE id = ANY(v_ventas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'ventas: %', n;
  END IF;

  -- ── Los turnos de caja de prueba ──────────────────────────────────────
  SELECT array_agg(id) INTO v_cajas
    FROM roldanerp.cajas
   WHERE coalesce(observacion_apertura, '') NOT LIKE 'Migrado del sistema anterior%';

  IF v_cajas IS NOT NULL THEN
    DELETE FROM roldanerp.caja_movimientos WHERE caja_id = ANY(v_cajas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'movimientos de caja: %', n;

    DELETE FROM roldanerp.cajas WHERE id = ANY(v_cajas);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'turnos de caja: %', n;
  END IF;

  -- ── Cheques de prueba ─────────────────────────────────────────────────
  --   Van ANTES que las compras: una vez borrada la compra no se puede saber
  --   a qué apuntaba el cheque. `cheque_compras.compra_numero_control` es
  --   texto, no una clave foránea, así que al borrar la compra el cheque no
  --   da error: queda huérfano y sigue proyectando un pago que no existe.
  --
  --   Uno de los dos cheques cargados es justamente el de 128.000 USD por una
  --   factura de 128.000 Gs., que sin esto seguiría apareciendo en el flujo.
  IF to_regclass('roldanerp.cheques') IS NOT NULL
     AND to_regclass('roldanerp.cheque_compras') IS NOT NULL THEN
    SELECT array_agg(DISTINCT cc.cheque_id) INTO v_chq
      FROM roldanerp.cheque_compras cc
      LEFT JOIN roldanerp.compras c ON c.numero_control = cc.compra_numero_control
     WHERE c.numero_control IS NULL OR c.numero_control NOT LIKE 'HCO-%';

    IF v_chq IS NOT NULL THEN
      DELETE FROM roldanerp.cheque_compras WHERE cheque_id = ANY(v_chq);
      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'cheque_compras: %', n;
      DELETE FROM roldanerp.cheques WHERE id = ANY(v_chq);
      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'cheques: %', n;
    END IF;
  END IF;

  -- ── Compras y anticipos de prueba ─────────────────────────────────────
  DELETE FROM roldanerp.compras
   WHERE numero_control IS NULL OR numero_control NOT LIKE 'HCO-%';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'compras: %', n;

  DELETE FROM roldanerp.anticipos
   WHERE coalesce(observacion, '') NOT LIKE 'Migrado del sistema anterior%';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'anticipos: %', n;

  -- ── Productos de prueba ───────────────────────────────────────────────
  --   Acá sí se mira el SKU: son los seis que se crearon probando y el patrón
  --   (QA-, PRU-, REV-) no existe en el catálogo real, donde los códigos son
  --   del tipo C606012 o FP1TG.
  SELECT array_agg(id) INTO v_prods
    FROM roldanerp.productos
   WHERE sku LIKE 'QA-%' OR sku LIKE 'PRU-%' OR sku LIKE 'REV-%';

  IF v_prods IS NOT NULL THEN
    DELETE FROM roldanerp.movimientos_inventario WHERE producto_id = ANY(v_prods);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'movimientos de esos productos: %', n;

    DELETE FROM roldanerp.inventario_stock_ubicacion WHERE producto_id = ANY(v_prods);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'stock por depósito: %', n;

    DELETE FROM roldanerp.productos WHERE id = ANY(v_prods);
    GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'productos: %', n;
  END IF;

  -- ── Clientes de prueba ────────────────────────────────────────────────
  DELETE FROM roldanerp.clientes
   WHERE coalesce(notas, '') NOT LIKE 'Migrado del sistema anterior%';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'clientes: %', n;

  -- ── Catálogos de prueba ───────────────────────────────────────────────
  --   Van DESPUÉS de los clientes y los productos: son las categorías a las
  --   que esas filas apuntaban.
  DELETE FROM roldanerp.categorias_cliente
   WHERE nombre NOT IN ('Precio Base', 'Minorista', 'Mayorista 1',
                        'Mayorista 2', 'Mayorista 3', 'Mayorista 4');
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'categorías de cliente: %', n;

  DELETE FROM roldanerp.categorias_productos
   WHERE coalesce(descripcion, '') NOT LIKE 'Migrado del sistema anterior%';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'rubros: %', n;
END
$limpieza$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Qué quedó
-- ---------------------------------------------------------------------------
DO $resumen$
DECLARE
  v_p int; v_c int; v_v int; v_i int; v_k int; v_r int; v_co int; v_a int;
BEGIN
  SELECT count(*) INTO v_p FROM roldanerp.productos;
  SELECT count(*) INTO v_c FROM roldanerp.clientes;
  SELECT count(*) INTO v_v FROM roldanerp.ventas;
  SELECT count(*) INTO v_i FROM roldanerp.ventas_items;
  SELECT count(*) INTO v_k FROM roldanerp.cajas;
  SELECT count(*) INTO v_r FROM roldanerp.categorias_productos;
  SELECT count(*) INTO v_co FROM roldanerp.compras;
  SELECT count(*) INTO v_a FROM roldanerp.anticipos;
  RAISE NOTICE '';
  RAISE NOTICE 'QUEDÓ SOLO LO DEL CLIENTE:';
  RAISE NOTICE '  productos % · clientes % · rubros %', v_p, v_c, v_r;
  RAISE NOTICE '  ventas % con % lineas · compras % · anticipos %', v_v, v_i, v_co, v_a;
  RAISE NOTICE '  turnos de caja %', v_k;
  RAISE NOTICE '';
  RAISE NOTICE 'Lo esperado: 996 productos, 21.344 clientes, 55 rubros,';
  RAISE NOTICE '85.665 ventas con 187.785 lineas, 17.017 compras, 948 anticipos,';
  RAISE NOTICE '2.136 turnos de caja.';
END
$resumen$;
