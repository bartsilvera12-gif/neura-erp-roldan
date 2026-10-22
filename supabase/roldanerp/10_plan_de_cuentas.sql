-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 10 · Plan de cuentas y configuración contable
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   El Libro Diario y el Mayor salían vacíos: compras, ventas, cobros y pagos
--   no generaban ningún asiento. No es un bug del generador de asientos — el
--   generador está y funciona — sino que no tenía contra qué imputar:
--
--     · `plan_cuentas` estaba vacío (el clon copia estructura, no filas).
--     · `configuracion_contable` no decía qué cuenta usar para IVA, caja,
--       proveedores, clientes ni ventas, así que cada intento de asiento se
--       quedaba sin cuenta de contrapartida.
--
--   Este script carga un plan de cuentas básico paraguayo y deja la
--   configuración apuntando a las cuentas correctas. Después de correrlo, las
--   operaciones NUEVAS generan asiento.
--
--   Las operaciones YA cargadas no se recalculan solas: para eso están
--   `/api/contabilidad/backfill-ventas` y `/api/contabilidad/backfill-anticipos`.
--
-- PLAN DE CUENTAS
--   Es un plan mínimo y genérico, pensado para arrancar. Las cuentas se pueden
--   renombrar, agregar o desactivar desde Contabilidad → Plan de cuentas sin
--   tocar este script. Lo que NO conviene es borrar las que la configuración
--   referencia: el asiento se quedaría otra vez sin contrapartida.
--
--   Naturaleza: 'D' = deudora (activo, gasto), 'A' = acreedora (pasivo,
--   patrimonio, ingreso). `asentable` = true significa que admite movimientos;
--   las cuentas de agrupación (nivel 1 y 2) no.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero el script 01.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roldanerp.empresas) THEN
    RAISE EXCEPTION 'No hay empresa en `roldanerp`. Correr primero el script 02.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'plan_cuentas' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.plan_cuentas`. Revisar el clon del script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Plan de cuentas
-- ---------------------------------------------------------------------------
DO $plan$
DECLARE
  v_empresa uuid;
  v_n       int;
BEGIN
  SELECT id INTO v_empresa FROM roldanerp.empresas LIMIT 1;

  -- Sin ON CONFLICT: el clon no garantiza un índice único sobre (empresa, cuenta),
  -- y si no existe la cláusula aborta la transacción entera.
  INSERT INTO roldanerp.plan_cuentas
    (empresa_id, cuenta, denominacion, nivel, naturaleza, asentable, activo)
  SELECT v_empresa, v.cuenta, v.denominacion, v.nivel, v.naturaleza, v.asentable, true
  FROM (VALUES
    -- ── 1 ACTIVO ───────────────────────────────────────────────────────────
    ('1',         'ACTIVO',                          1, 'D', false),
    ('1.1',       'ACTIVO CORRIENTE',                2, 'D', false),
    ('1.1.01',    'Caja',                            3, 'D', true ),
    ('1.1.02',    'Bancos',                          3, 'D', true ),
    ('1.1.03',    'Créditos por ventas (Clientes)',  3, 'D', true ),
    ('1.1.04',    'IVA Crédito Fiscal 10%',          3, 'D', true ),
    ('1.1.05',    'IVA Crédito Fiscal 5%',           3, 'D', true ),
    ('1.1.06',    'Mercaderías',                     3, 'D', true ),
    ('1.1.07',    'Anticipos a proveedores',         3, 'D', true ),
    ('1.2',       'ACTIVO NO CORRIENTE',             2, 'D', false),
    ('1.2.01',    'Muebles y útiles',                3, 'D', true ),
    ('1.2.02',    'Rodados',                         3, 'D', true ),
    -- ── 2 PASIVO ───────────────────────────────────────────────────────────
    ('2',         'PASIVO',                          1, 'A', false),
    ('2.1',       'PASIVO CORRIENTE',                2, 'A', false),
    ('2.1.01',    'Proveedores',                     3, 'A', true ),
    ('2.1.02',    'IVA Débito Fiscal 10%',           3, 'A', true ),
    ('2.1.03',    'IVA Débito Fiscal 5%',            3, 'A', true ),
    ('2.1.04',    'Anticipos de clientes',           3, 'A', true ),
    ('2.1.05',    'Cheques emitidos a pagar',        3, 'A', true ),
    ('2.1.06',    'Sueldos y jornales a pagar',      3, 'A', true ),
    ('2.1.07',    'IPS a pagar',                     3, 'A', true ),
    -- ── 3 PATRIMONIO ───────────────────────────────────────────────────────
    ('3',         'PATRIMONIO NETO',                 1, 'A', false),
    ('3.1',       'CAPITAL Y RESULTADOS',            2, 'A', false),
    ('3.1.01',    'Capital',                         3, 'A', true ),
    ('3.1.02',    'Resultados acumulados',           3, 'A', true ),
    -- ── 4 INGRESOS ─────────────────────────────────────────────────────────
    ('4',         'INGRESOS',                        1, 'A', false),
    ('4.1',       'INGRESOS OPERATIVOS',             2, 'A', false),
    ('4.1.01',    'Ventas gravadas 10%',             3, 'A', true ),
    ('4.1.02',    'Ventas gravadas 5%',              3, 'A', true ),
    ('4.1.03',    'Ventas exentas',                  3, 'A', true ),
    ('4.1.04',    'Ventas de servicios',             3, 'A', true ),
    ('4.1.05',    'Descuentos obtenidos',            3, 'A', true ),
    -- ── 5 EGRESOS ──────────────────────────────────────────────────────────
    ('5',         'EGRESOS',                         1, 'D', false),
    ('5.1',       'COSTO DE VENTAS',                 2, 'D', false),
    ('5.2',       'GASTOS OPERATIVOS',               2, 'D', false),
    ('5.3',       'RESULTADOS FINANCIEROS',          2, 'D', false),
    ('5.1.01',    'Costo de mercaderías vendidas',   3, 'D', true ),
    ('5.1.02',    'Compras',                         3, 'D', true ),
    ('5.2.01',    'Sueldos y jornales',              3, 'D', true ),
    ('5.2.02',    'Aporte patronal IPS',             3, 'D', true ),
    ('5.2.03',    'Alquileres',                      3, 'D', true ),
    ('5.2.04',    'Servicios públicos',              3, 'D', true ),
    ('5.2.05',    'Fletes y transporte',             3, 'D', true ),
    ('5.2.06',    'Gastos bancarios',                3, 'D', true ),
    ('5.2.07',    'Gastos varios',                   3, 'D', true ),
    ('5.3.01',    'Diferencia de cambio',            3, 'D', true )
  ) AS v(cuenta, denominacion, nivel, naturaleza, asentable)
  WHERE NOT EXISTS (
    SELECT 1 FROM roldanerp.plan_cuentas pc
     WHERE pc.empresa_id = v_empresa AND pc.cuenta = v.cuenta
  );

  -- Colgar cada cuenta de su padre por prefijo, si la columna existe.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'roldanerp' AND table_name = 'plan_cuentas'
      AND column_name = 'cuenta_padre_id'
  ) THEN
    UPDATE roldanerp.plan_cuentas h
       SET cuenta_padre_id = p.id
      FROM roldanerp.plan_cuentas p
     WHERE h.empresa_id = v_empresa
       AND p.empresa_id = v_empresa
       AND h.cuenta_padre_id IS NULL
       AND h.cuenta <> p.cuenta
       -- Padre = todo lo que está antes del último punto: '1.1.01' → '1.1'.
       AND p.cuenta = left(h.cuenta, length(h.cuenta) - strpos(reverse(h.cuenta), '.'))
       AND strpos(h.cuenta, '.') > 0;
  END IF;

  SELECT count(*) INTO v_n FROM roldanerp.plan_cuentas WHERE empresa_id = v_empresa;
  RAISE NOTICE 'Plan de cuentas: % cuentas.', v_n;
END
$plan$;

-- ---------------------------------------------------------------------------
-- 2) Configuración contable apuntando al plan recién cargado
--    Sin esto el generador de asientos no sabe qué cuenta usar y no escribe
--    nada: es la causa de que el Libro Diario saliera vacío.
-- ---------------------------------------------------------------------------
DO $cfg$
DECLARE
  v_empresa uuid;
  v_faltan  text := '';
  r         record;

  -- Qué campo de la configuración apunta a qué número de cuenta.
  v_mapa constant text[][] := ARRAY[
    ['cuenta_iva_credito_10_id',    '1.1.04'],
    ['cuenta_iva_credito_5_id',     '1.1.05'],
    ['cuenta_proveedores_id',       '2.1.01'],
    ['cuenta_caja_id',              '1.1.01'],
    ['cuenta_banco_id',             '1.1.02'],
    ['cuenta_iva_debito_10_id',     '2.1.02'],
    ['cuenta_iva_debito_5_id',      '2.1.03'],
    ['cuenta_ventas_gravadas_id',   '4.1.01'],
    ['cuenta_ventas_exentas_id',    '4.1.03'],
    ['cuenta_ventas_servicios_id',  '4.1.04'],
    ['cuenta_clientes_id',          '1.1.03'],
    ['cuenta_anticipos_clientes_id','2.1.04']
  ];
  v_campo   text;
  v_cuenta  text;
  v_id      uuid;
  i         int;
BEGIN
  SELECT id INTO v_empresa FROM roldanerp.empresas LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'configuracion_contable' AND c.relkind IN ('r','p')
  ) THEN
    RAISE NOTICE 'No existe `configuracion_contable`; se omite esta parte.';
    RETURN;
  END IF;

  -- Una fila por empresa.
  IF NOT EXISTS (SELECT 1 FROM roldanerp.configuracion_contable WHERE empresa_id = v_empresa) THEN
    INSERT INTO roldanerp.configuracion_contable (empresa_id) VALUES (v_empresa);
  END IF;

  FOR i IN 1 .. array_length(v_mapa, 1) LOOP
    v_campo  := v_mapa[i][1];
    v_cuenta := v_mapa[i][2];

    -- Si el schema no tiene ese campo, se saltea en vez de abortar.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'roldanerp' AND table_name = 'configuracion_contable'
        AND column_name = v_campo
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_id FROM roldanerp.plan_cuentas
     WHERE empresa_id = v_empresa AND cuenta = v_cuenta LIMIT 1;

    IF v_id IS NULL THEN
      v_faltan := v_faltan || ' ' || v_cuenta;
      CONTINUE;
    END IF;

    -- Solo se completa lo que está vacío: si alguien ya eligió otra cuenta a
    -- mano, este script no se la pisa.
    EXECUTE format(
      'UPDATE roldanerp.configuracion_contable SET %I = $1 WHERE empresa_id = $2 AND %I IS NULL',
      v_campo, v_campo
    ) USING v_id, v_empresa;
  END LOOP;

  IF v_faltan <> '' THEN
    RAISE NOTICE 'Cuentas no encontradas para la configuración:%', v_faltan;
  END IF;

  FOR r IN
    SELECT count(*) AS n FROM roldanerp.configuracion_contable WHERE empresa_id = v_empresa
  LOOP
    RAISE NOTICE 'Configuración contable: % fila(s).', r.n;
  END LOOP;
END
$cfg$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Sin esto PostgREST sigue sirviendo el esquema viejo.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- DESPUÉS DE CORRER ESTE SCRIPT
--
--   1. Contabilidad → Configuración contable: revisar que las cuentas que
--      quedaron asignadas sean las que usa el contador. Se cambian desde ahí.
--   2. Las operaciones nuevas ya generan asiento. Para las anteriores, correr
--      el backfill de ventas desde la app.
-- ---------------------------------------------------------------------------
