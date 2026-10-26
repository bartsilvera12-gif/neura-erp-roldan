-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 28 · Módulo 10 · Código de cliente
-- ============================================================================
--
-- Punto 10.3: "Cuentas por cobrar: clientes con códigos y saldos, filtros
-- amplios, cancelación o disminución de deuda por recibos, conservando
-- historial."
--
-- ── POR QUÉ UN CÓDIGO Y NO ALCANZA EL RUC ─────────────────────────────────
--   El RUC identifica al contribuyente, no al cliente: hay clientes sin RUC
--   (consumidor final), hay dos clientes con el mismo RUC (una empresa y su
--   dueño), y el RUC se tipea mal. Un código corto y propio —CLI-00001— es lo
--   que se dice por teléfono y lo que se escribe en una lista de morosos sin
--   tener que copiar un nombre largo.
--
--   El id interno (uuid) no sirve para eso: nadie dicta por teléfono
--   "a3f9c2e1-...".
--
-- ── EL TRIGGER, Y NO LA APLICACIÓN ────────────────────────────────────────
--   Los clientes se crean desde varios lugares: la pantalla de clientes, el
--   alta rápida desde Caja (punto 3.2), la importación por Excel y el alta
--   dentro de una venta. Si el número lo pusiera la aplicación, alguno de esos
--   caminos se olvidaría y aparecerían clientes sin código. Mismo criterio que
--   el número de ajuste (1.4) y el de anticipo (5.6).
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.clientes') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.clientes. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) La columna
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.clientes
  ADD COLUMN IF NOT EXISTS codigo text NULL;

COMMENT ON COLUMN roldanerp.clientes.codigo IS
  'Código corto del cliente (CLI-00001). Lo asigna un trigger; no se edita a mano.';

-- ---------------------------------------------------------------------------
-- 2) Backfill por orden de alta
-- ---------------------------------------------------------------------------
--   El orden importa: numerar por fecha de alta hace que los códigos bajos
--   sean los clientes viejos, que es lo que la gente espera. Numerar al azar
--   haría que el cliente de toda la vida tuviera el CLI-00300.
DO $backfill$
DECLARE
  r      record;
  v_emp  uuid := NULL;
  v_next int  := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.empresa_id
      FROM roldanerp.clientes c
     WHERE c.codigo IS NULL
     ORDER BY c.empresa_id, c.created_at NULLS LAST, c.id
  LOOP
    IF v_emp IS DISTINCT FROM r.empresa_id THEN
      v_emp := r.empresa_id;
      SELECT COALESCE(MAX(
               CASE WHEN codigo ~ '^CLI-[0-9]+$' THEN (substring(codigo from 5))::int ELSE 0 END
             ), 0)
        INTO v_next
        FROM roldanerp.clientes
       WHERE empresa_id = v_emp;
    END IF;

    v_next := v_next + 1;
    UPDATE roldanerp.clientes
       SET codigo = 'CLI-' || lpad(v_next::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 3) Unicidad por empresa
-- ---------------------------------------------------------------------------
DO $dup$
DECLARE v_dup text;
BEGIN
  SELECT string_agg(DISTINCT codigo, ', ') INTO v_dup
    FROM (
      SELECT empresa_id, codigo FROM roldanerp.clientes
       WHERE codigo IS NOT NULL
       GROUP BY empresa_id, codigo HAVING count(*) > 1
    ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'Hay codigos de cliente repetidos: %. Resolver antes del indice unico.', v_dup;
  END IF;
END
$dup$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_codigo
  ON roldanerp.clientes (empresa_id, codigo)
  WHERE codigo IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) El trigger para los que vengan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION roldanerp.asignar_codigo_cliente()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE v_next int;
BEGIN
  IF NEW.codigo IS NOT NULL AND btrim(NEW.codigo) <> '' THEN
    RETURN NEW;
  END IF;

  -- Lock por empresa: dos altas simultáneas se serializan en vez de leer el
  -- mismo máximo y escribir el mismo código. El índice único es el respaldo.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.empresa_id::text || ':codigo_cliente'));

  SELECT COALESCE(MAX(
           CASE WHEN codigo ~ '^CLI-[0-9]+$' THEN (substring(codigo from 5))::int ELSE 0 END
         ), 0) + 1
    INTO v_next
    FROM roldanerp.clientes
   WHERE empresa_id = NEW.empresa_id;

  NEW.codigo := 'CLI-' || lpad(v_next::text, 5, '0');
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_asignar_codigo_cliente ON roldanerp.clientes;
CREATE TRIGGER trg_asignar_codigo_cliente
  BEFORE INSERT ON roldanerp.clientes
  FOR EACH ROW
  EXECUTE FUNCTION roldanerp.asignar_codigo_cliente();

-- ---------------------------------------------------------------------------
-- 5) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE v_sin int;
BEGIN
  SELECT count(*) INTO v_sin FROM roldanerp.clientes WHERE codigo IS NULL;
  IF v_sin > 0 THEN
    RAISE EXCEPTION 'Quedaron % clientes sin codigo.', v_sin;
  END IF;
  RAISE NOTICE '10.3 listo: codigo de cliente asignado y con trigger.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
