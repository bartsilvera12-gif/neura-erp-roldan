-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 25 · Módulo 5 · Caja y arqueo
-- ============================================================================
--
-- Base de los puntos 5.5 (diferencias y arrastre), 5.6 (anticipos) y
-- 5.7 (egresos tipificados con adjuntos).
--
-- ── 5.5 · POR QUÉ LA DIFERENCIA SE ARRASTRA Y NO SE BORRA ──────────────────
--   "Mostrar el arqueo anterior y arrastrar o reflejar la diferencia negativa
--   al control del día siguiente, manteniendo trazabilidad."
--
--   Un faltante que se olvida al cerrar el turno es un faltante que nadie
--   investiga. Arrastrarlo hace que el turno siguiente abra sabiendo que hay
--   plata que explicar, y que el que la encuentra pueda cerrarlo.
--
--   `diferencia_arrastrada` es lo que viene del turno anterior y
--   `arrastre_de_caja_id` de cuál vino: sin esa segunda columna el número
--   aparecería solo, sin forma de rastrear de dónde salió.
--
-- ── 5.6 · ANTICIPOS ────────────────────────────────────────────────────────
--   Plata que el cliente dejó a cuenta y todavía no se facturó. No es una
--   venta: es una deuda de la empresa con el cliente hasta que se use.
--
--   Por eso tiene estado propio (activo / utilizado / anulado) y no se mezcla
--   con los movimientos de caja: hay que poder listar "cuánto debemos en
--   mercadería" sin recorrer turnos.
--
--   El número lo pone un trigger, por el mismo motivo que los ajustes del
--   punto 1.4: se crean desde más de un lugar y alguno se olvidaría.
--
-- ── 5.7 · EGRESOS ──────────────────────────────────────────────────────────
--   `tipo_egreso` clasifica la salida y `adjuntos` guarda factura y recibo.
--   Un egreso sin tipo no se puede sumar por concepto a fin de mes, y uno sin
--   respaldo no se puede defender ante el contador.
--
-- Requiere 01, 02, 05 y 09 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.cajas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.cajas`. Correr 05_modulo_caja.sql primero.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 5.5 · Arrastre de la diferencia
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.cajas
  ADD COLUMN IF NOT EXISTS diferencia_arrastrada numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arrastre_de_caja_id   uuid    NULL,
  ADD COLUMN IF NOT EXISTS diferencia_resuelta   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS diferencia_motivo     text    NULL;

COMMENT ON COLUMN roldanerp.cajas.diferencia_arrastrada IS
  'Punto 5.5. Diferencia que viene del turno anterior. Negativa = faltante que todavia hay que explicar.';
COMMENT ON COLUMN roldanerp.cajas.arrastre_de_caja_id IS
  'Punto 5.5. De que turno vino la diferencia arrastrada. Sin esto el numero aparece solo y no se puede rastrear.';
COMMENT ON COLUMN roldanerp.cajas.diferencia_resuelta IS
  'Punto 5.5. La diferencia de ESTE turno ya fue explicada, asi que no se arrastra al siguiente.';

-- ---------------------------------------------------------------------------
-- 5.7 · Egresos tipificados con respaldo
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.caja_movimientos
  ADD COLUMN IF NOT EXISTS tipo_egreso text  NULL,
  ADD COLUMN IF NOT EXISTS adjuntos    jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN roldanerp.caja_movimientos.tipo_egreso IS
  'Punto 5.7. Clasificacion del egreso (proveedor, flete, sueldo, servicios, otros...). NULL en lo que no es egreso.';
COMMENT ON COLUMN roldanerp.caja_movimientos.adjuntos IS
  'Punto 5.7. [{tipo: factura|recibo|otro, nombre, path, url}]. Respaldo del egreso.';

-- ---------------------------------------------------------------------------
-- 5.6 · Anticipos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.anticipos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  sucursal_id   uuid NULL,
  numero        text NULL,

  cliente_id    uuid NULL,
  -- Snapshot: si el cliente se edita o se da de baja, el anticipo tiene que
  -- seguir diciendo de quién era.
  cliente_nombre text NULL,

  fecha         timestamptz NOT NULL DEFAULT now(),
  monto         numeric NOT NULL,
  medio_pago    text NOT NULL DEFAULT 'efectivo',

  -- activo = la plata está a favor del cliente y todavía no se usó.
  -- utilizado = se aplicó a una venta. anulado = se devolvió o se canceló.
  estado        text NOT NULL DEFAULT 'activo',

  caja_id       uuid NULL,
  venta_id      uuid NULL,

  usuario_id     uuid NULL,
  usuario_nombre text NULL,
  observacion    text NULL,

  anulado_at     timestamptz NULL,
  anulado_por    text NULL,
  anulado_motivo text NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT anticipos_monto_chk  CHECK (monto > 0),
  CONSTRAINT anticipos_estado_chk CHECK (estado IN ('activo', 'utilizado', 'anulado')),
  -- Anular sin motivo deja un anticipo que desapareció sin explicación, que es
  -- justo lo que alguien va a reclamar.
  CONSTRAINT anticipos_anulacion_chk
    CHECK (estado <> 'anulado' OR (anulado_motivo IS NOT NULL AND btrim(anulado_motivo) <> ''))
);

COMMENT ON TABLE roldanerp.anticipos IS
  'Punto 5.6. Plata que el cliente dejo a cuenta y todavia no se facturo. No es una venta: es una deuda con el cliente hasta que se use.';

CREATE SEQUENCE IF NOT EXISTS roldanerp.anticipo_numero_seq;

CREATE OR REPLACE FUNCTION roldanerp.asignar_numero_anticipo()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.numero IS NULL OR btrim(NEW.numero) = '' THEN
    NEW.numero := 'ANT-' || lpad(nextval('roldanerp.anticipo_numero_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_numero_anticipo ON roldanerp.anticipos;
CREATE TRIGGER trg_numero_anticipo
  BEFORE INSERT ON roldanerp.anticipos
  FOR EACH ROW
  EXECUTE FUNCTION roldanerp.asignar_numero_anticipo();

CREATE UNIQUE INDEX IF NOT EXISTS anticipos_numero_uq
  ON roldanerp.anticipos (empresa_id, numero);

CREATE INDEX IF NOT EXISTS anticipos_cliente_idx
  ON roldanerp.anticipos (empresa_id, cliente_id, estado);

CREATE INDEX IF NOT EXISTS anticipos_fecha_idx
  ON roldanerp.anticipos (empresa_id, fecha DESC);

-- Los activos son los que importan: es la plata que se debe en mercadería.
CREATE INDEX IF NOT EXISTS anticipos_activos_idx
  ON roldanerp.anticipos (empresa_id, sucursal_id, fecha DESC)
  WHERE estado = 'activo';

COMMIT;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_falta text;
BEGIN
  IF to_regclass('roldanerp.anticipos') IS NULL THEN
    RAISE EXCEPTION 'No se creo roldanerp.anticipos';
  END IF;

  FOR v_falta IN
    SELECT c FROM unnest(ARRAY['diferencia_arrastrada','arrastre_de_caja_id','diferencia_resuelta']) c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='roldanerp' AND table_name='cajas' AND column_name=c)
  LOOP
    RAISE EXCEPTION 'Falta cajas.%', v_falta;
  END LOOP;

  FOR v_falta IN
    SELECT c FROM unnest(ARRAY['tipo_egreso','adjuntos']) c
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='roldanerp' AND table_name='caja_movimientos' AND column_name=c)
  LOOP
    RAISE EXCEPTION 'Falta caja_movimientos.%', v_falta;
  END LOOP;

  RAISE NOTICE 'Modulo 5 listo: anticipos creada, arrastre de diferencia y egresos tipificados.';
END
$check$;

NOTIFY pgrst, 'reload schema';
