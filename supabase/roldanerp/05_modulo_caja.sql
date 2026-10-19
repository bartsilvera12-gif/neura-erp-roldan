-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 05 · Módulo Caja: turnos de apertura/cierre, movimientos manuales y arqueo
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   El schema `mexicana`, del que se clonó `roldanerp`, NO tiene sistema de caja
--   (está dicho tal cual en el código: "Mexicana NO tiene sistema de caja").
--   La caja que se portó viene de `neura-erp-hierros` y necesita estas tablas.
--
-- QUÉ CREA
--   * `cajas`            — un turno por fila: se abre con un monto, se le asocian
--                          ventas y movimientos, y se cierra con un arqueo.
--   * `caja_movimientos` — ingresos / egresos / retiros / ajustes manuales.
--   * `ventas.caja_id`   — a qué turno pertenece cada venta. El cierre agrupa por
--                          este campo, no por fecha calendario.
--
--   Consolida tres migraciones de hierros (cajas, multi-caja y arqueo por
--   denominaciones) en un solo script ya con el estado final.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'roldanerp') THEN
    RAISE EXCEPTION 'No existe el schema `roldanerp`. Correr primero el script 01.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'roldanerp' AND c.relname = 'ventas' AND c.relkind IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION 'No existe `roldanerp.ventas`. El clon del schema está incompleto.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) cajas — un turno por fila
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.cajas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL,
  -- Punto de caja: permite Caja 1, Caja 2, … operando en paralelo.
  numero_caja              integer NOT NULL DEFAULT 1,
  -- abierta → en_cierre (en conteo, no recibe más ventas) → cerrada
  estado                   text NOT NULL DEFAULT 'abierta'
                           CHECK (estado IN ('abierta', 'en_cierre', 'cerrada')),
  abierta_por              uuid NULL,
  cerrada_por              uuid NULL,
  fecha_apertura           timestamptz NOT NULL DEFAULT now(),
  fecha_cierre             timestamptz NULL,
  monto_apertura           numeric NOT NULL DEFAULT 0,
  -- Lo que contó el cajero al cerrar.
  monto_cierre_contado     numeric NULL,
  -- Lo que el sistema calculó que debía haber.
  monto_esperado_efectivo  numeric NULL,
  -- contado - esperado (positivo = sobra, negativo = falta).
  diferencia               numeric NULL,
  observacion_apertura     text NULL,
  observacion_cierre       text NULL,
  -- Detalle del conteo físico por denominación (null si se cargó monto directo).
  arqueo_apertura_json     jsonb NULL,
  arqueo_cierre_json       jsonb NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.cajas IS
  'Turnos de caja (apertura → arqueo → cierre). Una fila por turno, no por punto de caja.';

-- Garantía dura contra "abrir dos veces": a lo sumo un turno activo por
-- (empresa, número de caja). Caja 1 y Caja 2 sí pueden estar abiertas a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS cajas_activa_por_numero
  ON roldanerp.cajas (empresa_id, numero_caja)
  WHERE estado IN ('abierta', 'en_cierre');

CREATE INDEX IF NOT EXISTS cajas_empresa_fecha_idx
  ON roldanerp.cajas (empresa_id, fecha_apertura DESC);

CREATE INDEX IF NOT EXISTS cajas_empresa_estado_idx
  ON roldanerp.cajas (empresa_id, estado);

-- ---------------------------------------------------------------------------
-- 2) caja_movimientos — ingresos / egresos / retiros / ajustes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.caja_movimientos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  caja_id      uuid NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('ingreso', 'egreso', 'retiro', 'ajuste')),
  concepto     text NOT NULL,
  monto        numeric NOT NULL,
  medio_pago   text NOT NULL DEFAULT 'efectivo'
               CHECK (medio_pago IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  usuario_id   uuid NULL,
  observacion  text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_movimientos_caja_fk
    FOREIGN KEY (caja_id) REFERENCES roldanerp.cajas(id) ON DELETE CASCADE
);

COMMENT ON TABLE roldanerp.caja_movimientos IS
  'Movimientos manuales de un turno de caja: ingresos, egresos, retiros y ajustes.';

CREATE INDEX IF NOT EXISTS caja_movimientos_caja_idx
  ON roldanerp.caja_movimientos (caja_id, created_at);

CREATE INDEX IF NOT EXISTS caja_movimientos_empresa_idx
  ON roldanerp.caja_movimientos (empresa_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) ventas.caja_id — a qué turno pertenece cada venta
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.ventas
  ADD COLUMN IF NOT EXISTS caja_id uuid NULL;

COMMENT ON COLUMN roldanerp.ventas.caja_id IS
  'Turno de caja de la venta. NULL si se emitió sin caja abierta. El cierre agrupa por este campo, no por fecha.';

CREATE INDEX IF NOT EXISTS ventas_caja_idx
  ON roldanerp.ventas (empresa_id, caja_id);

-- ---------------------------------------------------------------------------
-- 4) updated_at automático
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roldanerp.touch_cajas_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS cajas_touch ON roldanerp.cajas;
CREATE TRIGGER cajas_touch
  BEFORE UPDATE ON roldanerp.cajas
  FOR EACH ROW
  EXECUTE FUNCTION roldanerp.touch_cajas_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Privilegios: los mismos que ya tienen las demás tablas del schema
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT a.grantee, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(c.relacl) a
    WHERE n.nspname = 'roldanerp' AND c.relname = 'ventas'
  LOOP
    EXECUTE format('GRANT %s ON TABLE roldanerp.cajas, roldanerp.caja_movimientos TO %s',
                   r.privilege_type,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC'
                        ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid = r.grantee)) END);
  END LOOP;
END
$grants$;

-- ---------------------------------------------------------------------------
-- 6) RLS igual que `ventas`: si esa tabla la tiene activa, estas también.
--    Las políticas se copian de `ventas` sustituyendo el nombre de la tabla.
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE
  v_rls   boolean;
  r       record;
  t       text;
  v_sql   text;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'roldanerp' AND c.relname = 'ventas';

  IF NOT coalesce(v_rls, false) THEN
    RAISE NOTICE '`ventas` no tiene RLS: las tablas de caja quedan igual, sin RLS.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['cajas', 'caja_movimientos'] LOOP
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
      WHERE n.nspname = 'roldanerp' AND c.relname = 'ventas'
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
      IF r.qual IS NOT NULL THEN
        v_sql := v_sql || ' USING (' || r.qual || ')';
      END IF;
      IF r.withcheck IS NOT NULL THEN
        v_sql := v_sql || ' WITH CHECK (' || r.withcheck || ')';
      END IF;
      EXECUTE v_sql;
    END LOOP;
  END LOOP;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 7) Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_falta text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='roldanerp' AND c.relname='cajas') THEN
    v_falta := v_falta || ' cajas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='roldanerp' AND c.relname='caja_movimientos') THEN
    v_falta := v_falta || ' caja_movimientos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 JOIN pg_class c ON c.oid=a.attrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='roldanerp' AND c.relname='ventas'
                   AND a.attname='caja_id' AND a.attnum>0 AND NOT a.attisdropped) THEN
    v_falta := v_falta || ' ventas.caja_id';
  END IF;

  IF v_falta <> '' THEN
    RAISE EXCEPTION 'Faltó crear:%', v_falta;
  END IF;
  RAISE NOTICE 'Módulo Caja listo: cajas, caja_movimientos y ventas.caja_id.';
END
$check$;

COMMIT;
