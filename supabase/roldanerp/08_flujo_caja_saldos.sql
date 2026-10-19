-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 08 · Posición de liquidez del flujo (bancos, efectivo y mercadería)
-- ============================================================================
--
-- POR QUÉ ES UNA TABLA Y NO TRES COLUMNAS
--   El cliente lo dijo así: "los bancos cambian y la moneda en el que se guarda
--   ese banco cambia también, puede ser en dólares, guaraníes". O sea que no es
--   un dato fijo: son N cuentas, cada una con su banco y su moneda, y la lista
--   cambia con el tiempo. Con columnas fijas habría que migrar la tabla cada vez
--   que abren o cierran una cuenta.
--
-- QUÉ ES Y QUÉ NO ES
--   Son datos INFORMATIVOS: la foto de liquidez sobre la que se apoya el flujo.
--   NO son insumo de la proyección de pagos — esa sale sola de las compras.
--   Se cargan a mano, porque el ERP no tiene conciliación bancaria.
--
--   · banco      — una fila por cuenta: banco + moneda + saldo.
--   · efectivo   — plata en caja.
--   · mercaderia — valor del stock. Informativo: NO es plata disponible, así que
--                  no entra en los fondos con los que arranca el flujo.
--
-- Los fondos del mes pasan a ser la suma de bancos + efectivo (la mercadería
-- queda afuera). Si no se carga ninguna fila, sigue valiendo el monto manual de
-- `flujo_caja_config.fondos_disponibles`.
--
-- Requiere el script 07. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'flujo_caja_config'
  ) THEN
    RAISE EXCEPTION 'Falta `flujo_caja_config`. Correr primero el script 07.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.flujo_caja_saldos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  anio                 int NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  mes                  int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  tipo                 text NOT NULL CHECK (tipo IN ('banco', 'efectivo', 'mercaderia')),
  -- Nombre del banco, "Caja central", "Depósito", lo que corresponda.
  descripcion          text NOT NULL,
  entidad_bancaria_id  uuid,
  moneda               text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD')),
  importe              numeric NOT NULL DEFAULT 0,
  orden                int NOT NULL DEFAULT 0,
  observacion          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flujo_caja_saldos_uq UNIQUE (empresa_id, anio, mes, tipo, descripcion, moneda)
);

COMMENT ON TABLE roldanerp.flujo_caja_saldos IS
  'Posición de liquidez del mes: saldos por banco y moneda, efectivo y valor de mercadería. Carga manual, informativa.';
COMMENT ON COLUMN roldanerp.flujo_caja_saldos.tipo IS
  'banco | efectivo | mercaderia. La mercadería no cuenta como plata disponible.';

CREATE INDEX IF NOT EXISTS flujo_caja_saldos_periodo_idx
  ON roldanerp.flujo_caja_saldos (empresa_id, anio, mes, tipo);

DROP TRIGGER IF EXISTS flujo_caja_saldos_touch ON roldanerp.flujo_caja_saldos;
CREATE TRIGGER flujo_caja_saldos_touch BEFORE UPDATE ON roldanerp.flujo_caja_saldos
  FOR EACH ROW EXECUTE FUNCTION roldanerp.touch_updated_at_generic();

-- Privilegios y RLS calcados de `flujo_caja_config`, que ya los tomó de `compras`.
DO $perms$
DECLARE r record; v_rls boolean; v_sql text;
BEGIN
  FOR r IN
    SELECT DISTINCT a.grantee, a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname = 'roldanerp' AND c.relname = 'flujo_caja_config'
  LOOP
    EXECUTE format('GRANT %s ON TABLE roldanerp.flujo_caja_saldos TO %s',
                   r.privilege_type,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END);
  END LOOP;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'roldanerp' AND c.relname = 'flujo_caja_config';
  IF NOT coalesce(v_rls, false) THEN RETURN; END IF;

  EXECUTE 'ALTER TABLE roldanerp.flujo_caja_saldos ENABLE ROW LEVEL SECURITY';
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
    WHERE n.nspname = 'roldanerp' AND c.relname = 'flujo_caja_config'
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policy p2
      JOIN pg_class c2 ON c2.oid = p2.polrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'roldanerp' AND c2.relname = 'flujo_caja_saldos' AND p2.polname = r.polname
    ) THEN CONTINUE; END IF;

    v_sql := format('CREATE POLICY %I ON roldanerp.flujo_caja_saldos AS %s FOR %s TO %s',
                    r.polname,
                    CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                    r.cmd, coalesce(r.roles, 'PUBLIC'));
    IF r.qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || r.qual || ')'; END IF;
    IF r.withcheck IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || r.withcheck || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END
$perms$;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'flujo_caja_saldos'
  ) THEN
    RAISE EXCEPTION 'Faltó crear roldanerp.flujo_caja_saldos';
  END IF;
  RAISE NOTICE 'Posición de liquidez lista: roldanerp.flujo_caja_saldos.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
