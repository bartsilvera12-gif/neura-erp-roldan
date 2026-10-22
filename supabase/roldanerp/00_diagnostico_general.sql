-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 00 · Diagnóstico general — qué scripts corrieron y qué datos faltan
-- ============================================================================
--
-- Solo LEE. No modifica nada. Correlo entero y pasame la salida.
--
-- Está hecho para contestar, sin adivinar, por qué siguen fallando los puntos
-- del QA que dependen de la base y no del código.
-- ============================================================================

\echo '=== 1. Qué scripts corrieron ==='

SELECT
  '09_caja_columnas_faltantes' AS script,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='roldanerp' AND table_name='caja_movimientos' AND column_name='anulado_at'
  ) THEN 'CORRIÓ' ELSE 'FALTA — la caja no abre' END AS estado

UNION ALL SELECT '04_catalogos',
  CASE WHEN (SELECT count(*) FROM roldanerp.dashboard_views WHERE activo) > 0
       THEN 'CORRIÓ' ELSE 'FALTA — dashboard en blanco' END

UNION ALL SELECT '10_plan_de_cuentas',
  CASE WHEN EXISTS (SELECT 1 FROM roldanerp.plan_cuentas)
       THEN 'CORRIÓ' ELSE 'FALTA — libro diario vacío y config contable sin asignar' END

UNION ALL SELECT '11_llegadas_tarde',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='roldanerp' AND table_name='empleados' AND column_name='hora_entrada_prevista'
  ) THEN 'CORRIÓ' ELSE 'FALTA — no se miden tardanzas' END;

\echo ''
\echo '=== 2. Config contable: cuántas cuentas quedaron sin asignar ==='
-- Si da 12, el script 10 no corrió o no encontró las cuentas.

SELECT
  count(*) FILTER (WHERE cuenta_caja_id IS NULL)              AS caja,
  count(*) FILTER (WHERE cuenta_banco_id IS NULL)             AS banco,
  count(*) FILTER (WHERE cuenta_clientes_id IS NULL)          AS clientes,
  count(*) FILTER (WHERE cuenta_proveedores_id IS NULL)       AS proveedores,
  count(*) FILTER (WHERE cuenta_ventas_gravadas_id IS NULL)   AS ventas_gravadas,
  (SELECT count(*) FROM roldanerp.plan_cuentas)               AS cuentas_en_el_plan
FROM roldanerp.configuracion_contable;

\echo ''
\echo '=== 3. Sucursales duplicadas y sin timbrado (QA 13) ==='

SELECT id, codigo, nombre, establecimiento, punto_expedicion, activa,
       CASE WHEN count(*) OVER (PARTITION BY lower(btrim(nombre))) > 1
            THEN 'DUPLICADA por nombre' ELSE '' END AS aviso
FROM roldanerp.sucursales
ORDER BY lower(btrim(nombre)), codigo;

\echo ''
\echo '=== 4. Correos de empleados en mayúsculas (QA 19) ==='

SELECT count(*) FILTER (WHERE email <> lower(email)) AS en_mayusculas,
       count(*) FILTER (WHERE email IS NOT NULL)     AS con_correo
FROM roldanerp.empleados;

\echo ''
\echo '=== 5. ¿Hay un trigger que pase el correo a mayúsculas? ==='
-- Si aparece algo acá, el trigger le gana a la API y hay que sacarlo:
-- es la explicación de que el correo siga guardándose en mayúsculas.

SELECT t.tgname AS trigger, p.proname AS funcion
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p      ON p.oid = t.tgfoid
WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados' AND NOT t.tgisinternal;

\echo ''
\echo '=== 6. Productos con imagen cargada (QA 8) ==='
-- Si `con_imagen` da 0, el listado no tiene ninguna imagen que mostrar:
-- no es que no las muestre, es que no hay.

DO $img$
DECLARE v_t bigint; v_c bigint;
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE NOTICE 'No existe roldanerp.productos.';
    RETURN;
  END IF;
  EXECUTE $q$SELECT count(*), count(*) FILTER (WHERE imagen_url IS NOT NULL AND btrim(imagen_url) <> '')
               FROM roldanerp.productos$q$ INTO v_t, v_c;
  RAISE NOTICE 'Productos: %  ·  con imagen cargada: %', v_t, v_c;
END
$img$;

\echo ''
\echo '=== 7. Libro de Ventas: qué tablas fiscales existen (QA 16) ==='
-- El endpoint arma el libro con estas tablas. La que falte explica el 500.

SELECT t.tabla,
       CASE WHEN to_regclass('roldanerp.' || quote_ident(t.tabla)) IS NULL
            THEN 'NO EXISTE' ELSE 'existe' END AS estado
FROM unnest(ARRAY['facturas','factura_items','factura_electronica',
                  'nota_credito','nota_credito_electronica','empresa_sifen_config']) AS t(tabla);

\echo ''
\echo '=== 8. Asientos contables generados (QA 17) ==='

DO $asi$
DECLARE v_a bigint := -1; v_c bigint := -1; v_v bigint := -1;
BEGIN
  IF to_regclass('roldanerp.asientos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM roldanerp.asientos' INTO v_a;
  END IF;
  IF to_regclass('roldanerp.compras') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM roldanerp.compras' INTO v_c;
  END IF;
  IF to_regclass('roldanerp.ventas') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM roldanerp.ventas' INTO v_v;
  END IF;
  RAISE NOTICE 'Asientos: %  ·  líneas de compra: %  ·  ventas: %   (-1 = la tabla no existe)', v_a, v_c, v_v;
END
$asi$;
