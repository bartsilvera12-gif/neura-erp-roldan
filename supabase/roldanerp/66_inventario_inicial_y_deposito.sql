-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 66 · El inventario real entra al kardex y al depósito
-- ============================================================================
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
--   "Todo esto de estudio de precio, valoración y demás no lee el inventario
--   actual sino que lee el inventario anterior de prueba."
--
--   Es cierto, y no era un bug de las pantallas. El stock real vive en UNA sola
--   parte —la columna `productos.stock_actual`— y hay pantallas que leen de
--   otras dos, que quedaron con lo de las pruebas:
--
--     productos.stock_actual        410 artículos · Gs. 1.022.173.083  ← real
--     movimientos_inventario         75 movimientos de abril a octubre ← prueba
--     inventario_stock_ubicacion      6 filas                          ← prueba
--
--   La migración cargó la columna y nunca escribió las otras dos cosas: ni el
--   movimiento de INVENTARIO INICIAL de cada artículo —que es de donde sale el
--   kardex y, con él, la Valoración— ni la fila que dice en qué depósito está.
--
--   Medido: el kardex solo podía reconstruir 6 de los 410 artículos, por
--   Gs. 103.124.097, y de esos Gs. 99.940.000 —el 97%— eran el artículo de
--   prueba "PRUEBA2". La pantalla de Valoración mostraba, casi literalmente,
--   un solo artículo inventado.
--
-- ── QUÉ HACE ESTE SCRIPT ───────────────────────────────────────────────────
--   Por cada artículo con stock, escribe el movimiento que faltaba y lo pone
--   en el depósito, para que las tres fuentes digan lo mismo.
--
--   La cantidad del movimiento NO es el stock: es
--
--       stock_actual − lo que el kardex ya tenía sumado
--
--   Así la reconstrucción aterriza EXACTO en el stock real. Un artículo con 40
--   unidades cuyo kardex venía en −62 (porque tiene salidas de prueba sin la
--   entrada inicial) recibe 102, no 40.
--
-- ── ANTES DE ESTE SCRIPT, CORRER EL 53 ─────────────────────────────────────
--   El 53 saca los datos de prueba, los artículos PRUEBA y PRUEBA2 incluidos,
--   junto con las 46 ventas de prueba que los usan. Este script los saltea por
--   SKU para no cargarles un inventario inicial que el 53 va a borrar igual,
--   así que el orden no rompe nada — pero mientras el 53 no se corra, los
--   Gs. 99.940.000 de PRUEBA2 siguen inflando todos los totales.
--
-- ── LA FECHA DEL CONTEO ────────────────────────────────────────────────────
--   Abajo hay una variable `fecha_conteo`. Viene en la fecha de hoy, que es lo
--   honesto cuando no se sabe cuándo se contó: la Valoración a una fecha
--   anterior va a mostrar cero para estos artículos, porque el sistema
--   realmente no sabe qué había antes de que el inventario se cargara.
--
--   SI SABÉS CUÁNDO SE HIZO EL CONTEO FÍSICO, cambiala antes de correr. Con la
--   fecha correcta, la Valoración de los meses anteriores a ese día deja de
--   mentir por omisión.
--
-- ── IDEMPOTENTE ────────────────────────────────────────────────────────────
--   Se puede correr dos veces. La segunda no encuentra diferencia entre el
--   kardex y el stock, así que no inserta nada. Para reconocer lo suyo usa
--   `referencia = 'INVENTARIO INICIAL MIGRACION'`.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL
     OR to_regclass('roldanerp.movimientos_inventario') IS NULL
     OR to_regclass('roldanerp.inventario_ubicaciones') IS NULL
     OR to_regclass('roldanerp.inventario_stock_ubicacion') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas de inventario. Correr antes los scripts 01 y 51.';
  END IF;
END
$guard$;

DO $carga$
DECLARE
  -- ⚠ CAMBIAR SI SE SABE LA FECHA DEL CONTEO FÍSICO ⚠
  fecha_conteo  timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC' - interval '3 hours');

  -- Lo que el 53 va a borrar. No se les carga inventario inicial.
  skus_prueba   text[] := ARRAY['QA-%', 'PRU-%', 'REV-%'];

  emp           uuid;
  deposito      uuid;
  deposito_nom  text;
  insertados    int;
  ubicados      int;
BEGIN
  FOR emp IN SELECT DISTINCT empresa_id FROM roldanerp.productos WHERE empresa_id IS NOT NULL
  LOOP
    -- ── El depósito destino ────────────────────────────────────────────────
    -- Elegido con el cliente: DEPOSITO CENTRAL. Todo el stock entra ahí y
    -- desde ahí se transfiere lo que vaya a otro lado.
    SELECT id, nombre INTO deposito, deposito_nom
      FROM roldanerp.inventario_ubicaciones
     WHERE empresa_id = emp
       AND upper(nombre) = 'DEPOSITO CENTRAL'
       AND activo IS NOT false
     ORDER BY created_at
     LIMIT 1;

    IF deposito IS NULL THEN
      RAISE EXCEPTION
        'No existe el depósito "DEPOSITO CENTRAL" en la empresa %. Crealo en '
        'Inventario → Ubicaciones antes de correr este script, o cambiá el '
        'nombre acá arriba.', emp;
    END IF;

    RAISE NOTICE 'Empresa %: el stock va a "%" (%).', emp, deposito_nom, deposito;

    -- ── 1) El movimiento que faltaba ──────────────────────────────────────
    WITH saldo AS (
      SELECT p.id,
             p.nombre,
             p.sku,
             p.sucursal_id,
             coalesce(p.stock_actual, 0)   AS stock_real,
             coalesce(p.costo_promedio, 0) AS costo,
             coalesce((
               SELECT sum(
                 CASE
                   WHEN m.cantidad_delta IS NOT NULL THEN m.cantidad_delta
                   WHEN upper(m.tipo) = 'ENTRADA'    THEN  abs(m.cantidad)
                   WHEN upper(m.tipo) = 'SALIDA'     THEN -abs(m.cantidad)
                   -- Un AJUSTE viejo sin signo no se puede aplicar. Se lo deja
                   -- en cero a propósito: adivinarle el signo daría un stock
                   -- con pinta de exacto y mal.
                   ELSE 0
                 END)
                 FROM roldanerp.movimientos_inventario m
                WHERE m.empresa_id = emp
                  AND m.producto_id = p.id
             ), 0) AS saldo_kardex
        FROM roldanerp.productos p
       WHERE p.empresa_id = emp
         AND coalesce(p.stock_actual, 0) <> 0
         AND NOT (p.sku ILIKE ANY (skus_prueba))
    )
    INSERT INTO roldanerp.movimientos_inventario (
      empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
      tipo, origen, cantidad, cantidad_delta, costo_unitario,
      fecha, ubicacion_id, stock_antes, stock_despues, referencia, usuario_nombre
    )
    SELECT emp, s.sucursal_id, s.id, s.nombre, s.sku,
           -- `cantidad_delta` lleva el signo y es lo que manda en la
           -- reconstrucción; `tipo` acompaña para que el listado de
           -- Movimientos se lea bien.
           CASE WHEN s.stock_real - s.saldo_kardex > 0 THEN 'ENTRADA' ELSE 'AJUSTE' END,
           'inventario_inicial',
           abs(s.stock_real - s.saldo_kardex),
           s.stock_real - s.saldo_kardex,
           s.costo,
           fecha_conteo,
           deposito,
           s.saldo_kardex,
           s.stock_real,
           'INVENTARIO INICIAL MIGRACION',
           'Migración'
      FROM saldo s
     WHERE s.stock_real <> s.saldo_kardex;

    GET DIAGNOSTICS insertados = ROW_COUNT;
    RAISE NOTICE 'Empresa %: % movimientos de inventario inicial.', emp, insertados;

    -- ── 2) El stock en el depósito ────────────────────────────────────────
    -- Si el artículo ya tenía fila en ALGÚN depósito no se lo toca: esa fila
    -- la puso alguien a mano o una transferencia, y pisarla sería deshacer una
    -- decisión que nadie pidió deshacer.
    INSERT INTO roldanerp.inventario_stock_ubicacion
      (empresa_id, producto_id, ubicacion_id, stock_actual, es_principal)
    SELECT emp, p.id, deposito, coalesce(p.stock_actual, 0), true
      FROM roldanerp.productos p
     WHERE p.empresa_id = emp
       AND coalesce(p.stock_actual, 0) <> 0
       AND NOT (p.sku ILIKE ANY (skus_prueba))
       AND NOT EXISTS (
         SELECT 1 FROM roldanerp.inventario_stock_ubicacion su
          WHERE su.empresa_id = emp AND su.producto_id = p.id
       );

    GET DIAGNOSTICS ubicados = ROW_COUNT;
    RAISE NOTICE 'Empresa %: % artículos ubicados en el depósito.', emp, ubicados;

    -- ── 3) El depósito por defecto de la ficha ────────────────────────────
    -- 996 de 1002 artículos no tenían ninguno, así que al cargar una compra no
    -- había a dónde mandarla.
    UPDATE roldanerp.productos p
       SET ubicacion_principal_id = deposito,
           updated_at = now()
     WHERE p.empresa_id = emp
       AND p.ubicacion_principal_id IS NULL
       AND NOT (p.sku ILIKE ANY (skus_prueba));

    GET DIAGNOSTICS ubicados = ROW_COUNT;
    RAISE NOTICE 'Empresa %: % fichas con depósito por defecto.', emp, ubicados;
  END LOOP;
END
$carga$;

-- ── Resumen: las tres fuentes tienen que coincidir ─────────────────────────
-- `de_prueba` son los QA-/PRU-/REV- que este script saltea a propósito: van a
-- salir como "no coinciden" y "sin depósito" hasta que se corra el 53, que los
-- borra. Cualquier otro número en esas dos columnas sí es un problema.
SELECT
  count(*)                                               AS articulos_con_stock,
  count(*) FILTER (WHERE p.sku ILIKE ANY (ARRAY['QA-%','PRU-%','REV-%']))
                                                         AS de_prueba,
  sum(p.stock_actual * coalesce(p.costo_promedio, 0))::numeric(18,0)
                                                         AS valor_segun_la_ficha,
  sum(k.saldo * coalesce(p.costo_promedio, 0))::numeric(18,0)
                                                         AS valor_segun_el_kardex,
  count(*) FILTER (WHERE p.stock_actual <> k.saldo
                     AND NOT p.sku ILIKE ANY (ARRAY['QA-%','PRU-%','REV-%']))
                                                         AS todavia_no_coinciden,
  count(*) FILTER (WHERE su.producto_id IS NULL
                     AND NOT p.sku ILIKE ANY (ARRAY['QA-%','PRU-%','REV-%']))
                                                         AS sin_deposito
FROM roldanerp.productos p
CROSS JOIN LATERAL (
  SELECT coalesce(sum(
    CASE
      WHEN m.cantidad_delta IS NOT NULL THEN m.cantidad_delta
      WHEN upper(m.tipo) = 'ENTRADA'    THEN  abs(m.cantidad)
      WHEN upper(m.tipo) = 'SALIDA'     THEN -abs(m.cantidad)
      ELSE 0
    END), 0) AS saldo
    FROM roldanerp.movimientos_inventario m
   WHERE m.empresa_id = p.empresa_id AND m.producto_id = p.id
) k
LEFT JOIN LATERAL (
  SELECT su.producto_id
    FROM roldanerp.inventario_stock_ubicacion su
   WHERE su.empresa_id = p.empresa_id AND su.producto_id = p.id
   LIMIT 1
) su ON true
WHERE coalesce(p.stock_actual, 0) <> 0;
