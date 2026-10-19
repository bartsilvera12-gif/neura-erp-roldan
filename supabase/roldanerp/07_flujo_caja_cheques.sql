-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 07 · Flujo de caja de proveedores + cheques
-- ============================================================================
--
-- QUÉ RESUELVE
--   La planilla de flujo que hoy se lleva a mano: proyección de pagos a
--   proveedores por día, con el estado de cada cheque.
--
--   · Una factura de compra a crédito cae en el día `fecha_factura + plazo_dias`.
--   · Un cheque es de UN proveedor y puede cubrir VARIAS facturas suyas.
--   · Estados del cheque (los tres colores de la planilla):
--       pendiente_emision → lila   · todavía no se emitió
--       emitido           → verde  · emitido, sin cobrar en ventanilla
--       cobrado           → amarillo · ya salió del banco; deja de proyectarse
--       anulado           → fuera del flujo
--
-- QUÉ CREA
--   · proveedores.agrupa_en_varios — los chicos / locales se suman en la fila VARIOS.
--   · cheques            — el cheque, con su número, banco, importe y fechas.
--   · cheque_compras     — qué facturas cubre cada cheque (N:N).
--   · flujo_caja_config  — por mes: tipo de cambio a usar y fondos disponibles.
--
-- Requiere 01 y 02. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero el script 01.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'compras' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.compras`.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Proveedores que se agrupan en la fila VARIOS
--    Criterio del cliente: proveedores chicos o locales. Es una marca manual.
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.proveedores
  ADD COLUMN IF NOT EXISTS agrupa_en_varios boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN roldanerp.proveedores.agrupa_en_varios IS
  'Si es true, sus pagos no llevan fila propia en el flujo: se suman en VARIOS.';

-- ---------------------------------------------------------------------------
-- 2) Cheques
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.cheques (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  proveedor_id          uuid NOT NULL,
  proveedor_nombre      text,
  -- Nulo mientras está pendiente de emisión: el número se asigna al emitirlo.
  numero                text,
  entidad_bancaria_id   uuid,
  banco_nombre          text,
  moneda                text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD')),
  importe               numeric NOT NULL CHECK (importe >= 0),
  estado                text NOT NULL DEFAULT 'pendiente_emision'
                        CHECK (estado IN ('pendiente_emision', 'emitido', 'cobrado', 'anulado')),
  -- Día del flujo en el que cae este pago.
  fecha_pago_prevista   date NOT NULL,
  fecha_emision         date,
  -- La fecha de cobro puede diferir de la de pago: por eso van separadas.
  fecha_cobro_prevista  date,
  fecha_cobro_real      date,
  observacion           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  CONSTRAINT cheques_proveedor_fk
    FOREIGN KEY (proveedor_id) REFERENCES roldanerp.proveedores(id) ON DELETE RESTRICT
);

COMMENT ON TABLE roldanerp.cheques IS
  'Cheques a proveedores. Un cheque es de un solo proveedor y puede cubrir varias de sus facturas.';

-- Dos cheques no pueden llevar el mismo número en el mismo banco.
CREATE UNIQUE INDEX IF NOT EXISTS cheques_numero_banco_uq
  ON roldanerp.cheques (empresa_id, entidad_bancaria_id, numero)
  WHERE numero IS NOT NULL AND estado <> 'anulado';

CREATE INDEX IF NOT EXISTS cheques_flujo_idx
  ON roldanerp.cheques (empresa_id, fecha_pago_prevista);
CREATE INDEX IF NOT EXISTS cheques_proveedor_idx
  ON roldanerp.cheques (empresa_id, proveedor_id);
CREATE INDEX IF NOT EXISTS cheques_estado_idx
  ON roldanerp.cheques (empresa_id, estado);

-- Un cheque emitido tiene que tener número y fecha de emisión; uno cobrado,
-- fecha de cobro real. Evita que la planilla quede con huecos.
ALTER TABLE roldanerp.cheques DROP CONSTRAINT IF EXISTS cheques_estado_datos_chk;
ALTER TABLE roldanerp.cheques ADD CONSTRAINT cheques_estado_datos_chk CHECK (
  CASE estado
    WHEN 'emitido' THEN numero IS NOT NULL AND fecha_emision IS NOT NULL
    WHEN 'cobrado' THEN numero IS NOT NULL AND fecha_emision IS NOT NULL AND fecha_cobro_real IS NOT NULL
    ELSE true
  END
);

-- ---------------------------------------------------------------------------
-- 3) Qué facturas cubre cada cheque
--    Se referencia la factura por `numero_control` (COMP-000001), que es la
--    unidad real: en `compras` una factura son N filas, una por producto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.cheque_compras (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  cheque_id             uuid NOT NULL,
  compra_numero_control text NOT NULL,
  -- Cuánto del cheque se imputa a esta factura (permite pagos parciales).
  importe_imputado      numeric NOT NULL CHECK (importe_imputado >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cheque_compras_cheque_fk
    FOREIGN KEY (cheque_id) REFERENCES roldanerp.cheques(id) ON DELETE CASCADE,
  CONSTRAINT cheque_compras_uq UNIQUE (cheque_id, compra_numero_control)
);

CREATE INDEX IF NOT EXISTS cheque_compras_compra_idx
  ON roldanerp.cheque_compras (empresa_id, compra_numero_control);

COMMENT ON TABLE roldanerp.cheque_compras IS
  'Facturas de compra que cubre cada cheque. La factura se identifica por numero_control.';

-- ---------------------------------------------------------------------------
-- 4) Configuración del flujo por mes
--    El tipo de cambio lo fija el cliente (usan uno más alto que el real como
--    colchón). Los fondos disponibles son el dinero a favor con el que arranca
--    el mes; el acumulado del flujo los va consumiendo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.flujo_caja_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  anio                int NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  mes                 int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  tipo_cambio         numeric NOT NULL DEFAULT 0 CHECK (tipo_cambio >= 0),
  fondos_disponibles  numeric NOT NULL DEFAULT 0,
  observacion         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flujo_caja_config_uq UNIQUE (empresa_id, anio, mes)
);

COMMENT ON TABLE roldanerp.flujo_caja_config IS
  'Por mes: tipo de cambio a aplicar en el flujo y fondos disponibles al inicio.';
COMMENT ON COLUMN roldanerp.flujo_caja_config.tipo_cambio IS
  'Cotización que decide el cliente, normalmente por encima de la real (colchón).';
COMMENT ON COLUMN roldanerp.flujo_caja_config.fondos_disponibles IS
  'Dinero a favor al inicio del mes, en guaraníes. El flujo lo va descontando.';

-- ---------------------------------------------------------------------------
-- 5) updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roldanerp.touch_updated_at_generic()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS cheques_touch ON roldanerp.cheques;
CREATE TRIGGER cheques_touch BEFORE UPDATE ON roldanerp.cheques
  FOR EACH ROW EXECUTE FUNCTION roldanerp.touch_updated_at_generic();

DROP TRIGGER IF EXISTS flujo_caja_config_touch ON roldanerp.flujo_caja_config;
CREATE TRIGGER flujo_caja_config_touch BEFORE UPDATE ON roldanerp.flujo_caja_config
  FOR EACH ROW EXECUTE FUNCTION roldanerp.touch_updated_at_generic();

-- ---------------------------------------------------------------------------
-- 6) Privilegios y RLS, calcados de `compras`
-- ---------------------------------------------------------------------------
DO $perms$
DECLARE
  r      record;
  t      text;
  v_rls  boolean;
  v_sql  text;
BEGIN
  FOR r IN
    SELECT DISTINCT a.grantee, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname = 'roldanerp' AND c.relname = 'compras'
  LOOP
    EXECUTE format(
      'GRANT %s ON TABLE roldanerp.cheques, roldanerp.cheque_compras, roldanerp.flujo_caja_config TO %s',
      r.privilege_type,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC'
           ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END);
  END LOOP;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'roldanerp' AND c.relname = 'compras';

  IF NOT coalesce(v_rls, false) THEN
    RAISE NOTICE '`compras` no tiene RLS: las tablas nuevas quedan igual, sin RLS.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['cheques', 'cheque_compras', 'flujo_caja_config'] LOOP
    EXECUTE format('ALTER TABLE roldanerp.%I ENABLE ROW LEVEL SECURITY', t);

    FOR r IN
      SELECT pol.polname,
             CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                             ELSE 'ALL' END AS cmd,
             pol.polpermissive,
             (SELECT string_agg(
                       CASE WHEN rolname IS NULL THEN 'PUBLIC' ELSE quote_ident(rolname) END, ', ')
                FROM (SELECT (SELECT r2.rolname FROM pg_roles r2 WHERE r2.oid = x) AS rolname
                      FROM unnest(pol.polroles) AS x) q) AS roles,
             pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
             pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
      FROM pg_policy pol
      JOIN pg_class c      ON c.oid = pol.polrelid
      JOIN pg_namespace n  ON n.oid = c.relnamespace
      WHERE n.nspname = 'roldanerp' AND c.relname = 'compras'
    LOOP
      IF EXISTS (
        SELECT 1 FROM pg_policy p2
        JOIN pg_class c2 ON c2.oid = p2.polrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE n2.nspname = 'roldanerp' AND c2.relname = t AND p2.polname = r.polname
      ) THEN
        CONTINUE;
      END IF;

      v_sql := format('CREATE POLICY %I ON roldanerp.%I AS %s FOR %s TO %s',
                      r.polname, t,
                      CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                      r.cmd, coalesce(r.roles, 'PUBLIC'));
      IF r.qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || r.qual || ')'; END IF;
      IF r.withcheck IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || r.withcheck || ')'; END IF;
      EXECUTE v_sql;
    END LOOP;
  END LOOP;
END
$perms$;

DO $check$
DECLARE v_falta text := '';
BEGIN
  FOR v_falta IN
    SELECT unnest(ARRAY['cheques','cheque_compras','flujo_caja_config']) AS t
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'roldanerp' AND c.relname = v_falta
    ) THEN
      RAISE EXCEPTION 'Faltó crear roldanerp.%', v_falta;
    END IF;
  END LOOP;
  RAISE NOTICE 'Flujo de caja listo: cheques, cheque_compras, flujo_caja_config y proveedores.agrupa_en_varios.';
END
$check$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Recargar el cache de esquema de PostgREST: sin esto la API no ve las tablas
-- nuevas aunque estén en la base.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
