-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 00 · Diagnóstico general — qué scripts corrieron y qué datos faltan
-- ============================================================================
--
-- Solo LEE. No modifica nada. Pegalo entero en el SQL editor y pasame la tabla.
--
-- Todo va por SQL dinámico a propósito: Postgres valida las tablas al
-- planificar la consulta, así que una referencia directa a una tabla que no
-- existe aborta el script entero antes de medir nada. Acá cada medición se
-- saltea sola si su tabla falta, que es justamente uno de los datos a reportar.
-- ============================================================================

DROP TABLE IF EXISTS diag;
CREATE TEMP TABLE diag (seccion text, dato text, valor text);

DO $diag$
DECLARE
  v_txt text;
  v_n   bigint;
  r     record;

BEGIN
  -- ── 1. Qué scripts corrieron ──────────────────────────────────────────────
  INSERT INTO diag VALUES ('1. Scripts', '09_caja_columnas_faltantes',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='roldanerp' AND table_name='caja_movimientos' AND column_name='anulado_at')
    THEN 'CORRIO' ELSE 'FALTA -> la caja no abre' END);

  INSERT INTO diag VALUES ('1. Scripts', '11_llegadas_tarde',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='roldanerp' AND table_name='empleados' AND column_name='hora_entrada_prevista')
    THEN 'CORRIO' ELSE 'FALTA -> no se miden tardanzas' END);

  IF to_regclass('roldanerp.dashboard_views') IS NULL THEN
    INSERT INTO diag VALUES ('1. Scripts', '04_catalogos', 'no existe dashboard_views');
  ELSE
    EXECUTE 'SELECT count(*) FROM roldanerp.dashboard_views WHERE activo' INTO v_n;
    INSERT INTO diag VALUES ('1. Scripts', '04_catalogos',
      CASE WHEN v_n > 0 THEN 'CORRIO (' || v_n || ' vistas)' ELSE 'FALTA -> dashboard en blanco' END);
  END IF;

  IF to_regclass('roldanerp.plan_cuentas') IS NULL THEN
    INSERT INTO diag VALUES ('1. Scripts', '10_plan_de_cuentas', 'no existe plan_cuentas');
  ELSE
    EXECUTE 'SELECT count(*) FROM roldanerp.plan_cuentas' INTO v_n;
    INSERT INTO diag VALUES ('1. Scripts', '10_plan_de_cuentas',
      CASE WHEN v_n > 0 THEN 'CORRIO (' || v_n || ' cuentas)'
           ELSE 'FALTA -> libro diario vacio y config contable sin asignar' END);
  END IF;

  -- ── 2. Configuración contable (QA 17 y 18) ────────────────────────────────
  --    Si da 12, el script 10 no corrió o no encontró las cuentas.
  IF to_regclass('roldanerp.configuracion_contable') IS NOT NULL THEN
    EXECUTE $q$
      SELECT (cuenta_iva_credito_5_id IS NULL)::int + (cuenta_iva_credito_10_id IS NULL)::int +
             (cuenta_proveedores_id IS NULL)::int   + (cuenta_caja_id IS NULL)::int +
             (cuenta_banco_id IS NULL)::int         + (cuenta_iva_debito_5_id IS NULL)::int +
             (cuenta_iva_debito_10_id IS NULL)::int + (cuenta_ventas_gravadas_id IS NULL)::int +
             (cuenta_ventas_exentas_id IS NULL)::int+ (cuenta_ventas_servicios_id IS NULL)::int +
             (cuenta_clientes_id IS NULL)::int      + (cuenta_anticipos_clientes_id IS NULL)::int
        FROM roldanerp.configuracion_contable LIMIT 1
    $q$ INTO v_n;
    INSERT INTO diag VALUES ('2. Contabilidad', 'campos de config SIN asignar (de 12)', COALESCE(v_n::text, 'sin fila'));
  ELSE
    INSERT INTO diag VALUES ('2. Contabilidad', 'configuracion_contable', 'NO EXISTE la tabla');
  END IF;

  IF to_regclass('roldanerp.asientos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM roldanerp.asientos' INTO v_n;
    INSERT INTO diag VALUES ('2. Contabilidad', 'asientos generados', v_n::text);
  ELSE
    INSERT INTO diag VALUES ('2. Contabilidad', 'asientos', 'NO EXISTE la tabla');
  END IF;

  -- ── 3. Sucursales (QA 13) ─────────────────────────────────────────────────
  IF to_regclass('roldanerp.sucursales') IS NOT NULL THEN
    FOR r IN EXECUTE $q$
      SELECT codigo, nombre, activa,
             count(*) OVER (PARTITION BY lower(btrim(nombre))) AS repetidas,
             (establecimiento IS NULL OR btrim(establecimiento) = ''
               OR punto_expedicion IS NULL OR btrim(punto_expedicion) = '') AS sin_timbrado
        FROM roldanerp.sucursales ORDER BY codigo
    $q$ LOOP
      INSERT INTO diag VALUES ('3. Sucursales', r.codigo || ' - ' || r.nombre,
        CASE WHEN r.repetidas > 1 THEN 'DUPLICADA; ' ELSE '' END ||
        CASE WHEN r.sin_timbrado THEN 'sin establecimiento/punto; ' ELSE '' END ||
        CASE WHEN r.activa THEN 'activa' ELSE 'inactiva' END);
    END LOOP;
  END IF;

  -- ── 4. Correos de empleados (QA 19) ───────────────────────────────────────
  IF to_regclass('roldanerp.empleados') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM roldanerp.empleados
                WHERE email IS NOT NULL AND email <> lower(email)$q$ INTO v_n;
    INSERT INTO diag VALUES ('4. Empleados', 'correos en MAYUSCULAS', v_n::text);
  END IF;

  -- ── 5. Triggers sobre empleados (QA 19) ───────────────────────────────────
  --    Si alguno usa upper(), le gana a la API: esa sería la causa real.
  FOR r IN
    SELECT t.tgname, p.proname, pg_get_functiondef(p.oid) AS src
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p      ON p.oid = t.tgfoid
    WHERE n.nspname = 'roldanerp' AND c.relname = 'empleados' AND NOT t.tgisinternal
  LOOP
    INSERT INTO diag VALUES ('5. Triggers', r.tgname,
      r.proname || CASE WHEN r.src ~* 'upper\s*\(' THEN '   [USA upper()]' ELSE '' END);
  END LOOP;
  IF NOT FOUND THEN
    INSERT INTO diag VALUES ('5. Triggers', '(ninguno sobre empleados)', '-');
  END IF;

  -- ── 6. Imágenes de productos (QA 8) ───────────────────────────────────────
  --    Si "con imagen" da 0, el listado no tiene nada que mostrar: el problema
  --    está en la subida, no en el listado.
  IF to_regclass('roldanerp.productos') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*)::text || ' productos, ' ||
                      count(*) FILTER (WHERE imagen_url IS NOT NULL AND btrim(imagen_url) <> '')::text
                      || ' con imagen'
                 FROM roldanerp.productos$q$ INTO v_txt;
    INSERT INTO diag VALUES ('6. Productos', 'imagenes cargadas', v_txt);
  END IF;

  -- ── 7. Tablas fiscales del Libro de Ventas (QA 16) ────────────────────────
  --    La que falte explica el 500.
  FOR r IN
    SELECT unnest(ARRAY['facturas','factura_items','factura_electronica',
                        'nota_credito','nota_credito_electronica','empresa_sifen_config']) AS tabla
  LOOP
    INSERT INTO diag VALUES ('7. Libro de Ventas', r.tabla,
      CASE WHEN to_regclass('roldanerp.' || quote_ident(r.tabla)) IS NULL
           THEN 'NO EXISTE' ELSE 'existe' END);
  END LOOP;
END
$diag$;

SELECT * FROM diag ORDER BY seccion, dato;
