-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 17 · CJ-01 · Cambiar el medio real de cobro
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Observación CJ-01 del checklist: una factura al contado prevista en
--   efectivo que en la entrega se cobra por transferencia. El cajero tiene que
--   poder reclasificar el cobro SIN modificar ni anular la factura, sin doble
--   ingreso, y dejando rastro de quién lo hizo, cuándo y por qué.
--
--   El arqueo ya calcula los medios de pago leyendo `ventas.metodo_pago`, así
--   que reclasificar es cambiar ese campo. Lo que faltaba es el rastro: sin él,
--   el cambio sería invisible y el arqueo de ayer cambiaría solo.
--
-- REGLAS ACORDADAS CON EL CLIENTE (24-10-2026)
--   · El cajero reclasifica solo, sin pedir autorización.
--   · El comprobante de la transferencia NO es obligatorio.
--   · Si la caja YA CERRÓ, hace falta autorización del admin.
--
--   Por eso `autorizado_por` es NULL en el caso normal y obligatorio cuando
--   `caja_cerrada` es true: el CHECK lo fuerza, no queda librado al código.
--
-- Requiere 01, 02 y 05 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.ventas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.ventas`.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.reclasificaciones_cobro (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  venta_id         uuid NOT NULL,
  -- Snapshot: si la venta se edita después, esto tiene que seguir diciendo
  -- contra qué comprobante se hizo el cambio.
  venta_numero     text NULL,
  caja_id          uuid NULL,
  -- true si el turno ya estaba cerrado al reclasificar.
  caja_cerrada     boolean NOT NULL DEFAULT false,

  metodo_anterior  text NOT NULL,
  metodo_nuevo     text NOT NULL,
  monto            numeric NOT NULL,

  -- Datos del cobro nuevo. Ninguno obligatorio: el cliente acordó que el
  -- comprobante no lo es.
  entidad_bancaria_id uuid NULL,
  entidad_nombre      text NULL,
  referencia          text NULL,

  motivo           text NOT NULL,
  usuario_id       uuid NULL,
  usuario_nombre   text NULL,
  -- Solo cuando la caja estaba cerrada: quién autorizó el ajuste.
  autorizado_por   text NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reclasificaciones_cobro_venta_fk
    FOREIGN KEY (venta_id) REFERENCES roldanerp.ventas(id) ON DELETE RESTRICT,

  -- El medio no puede quedar igual: eso no sería una reclasificación.
  CONSTRAINT reclasificaciones_cobro_distinto_chk
    CHECK (metodo_anterior <> metodo_nuevo),

  -- Con la caja cerrada, la autorización del admin es obligatoria.
  CONSTRAINT reclasificaciones_cobro_autorizacion_chk
    CHECK (NOT caja_cerrada OR (autorizado_por IS NOT NULL AND btrim(autorizado_por) <> '')),

  CONSTRAINT reclasificaciones_cobro_motivo_chk
    CHECK (btrim(motivo) <> '')
);

COMMENT ON TABLE roldanerp.reclasificaciones_cobro IS
  'CJ-01. Historial de cambios de medio de cobro. La factura no se toca: acá queda el rastro de que el dinero entró por otra vía.';
COMMENT ON COLUMN roldanerp.reclasificaciones_cobro.caja_cerrada IS
  'true = el turno ya estaba cerrado. En ese caso autorizado_por es obligatorio (CHECK).';
COMMENT ON COLUMN roldanerp.reclasificaciones_cobro.autorizado_por IS
  'Admin que autorizó el ajuste sobre una caja cerrada. NULL en el caso normal.';

CREATE INDEX IF NOT EXISTS reclasificaciones_cobro_venta_idx
  ON roldanerp.reclasificaciones_cobro (empresa_id, venta_id);

CREATE INDEX IF NOT EXISTS reclasificaciones_cobro_fecha_idx
  ON roldanerp.reclasificaciones_cobro (empresa_id, created_at DESC);

-- Las que tocaron una caja cerrada son las que audita el contador.
CREATE INDEX IF NOT EXISTS reclasificaciones_cobro_cerradas_idx
  ON roldanerp.reclasificaciones_cobro (empresa_id, created_at DESC)
  WHERE caja_cerrada;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE
  r     record;
  v_bad text := '';
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'empresa_id','venta_id','caja_id','caja_cerrada','metodo_anterior','metodo_nuevo',
    'monto','entidad_bancaria_id','entidad_nombre','referencia','motivo',
    'usuario_id','usuario_nombre','autorizado_por'
  ]) AS c
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='roldanerp' AND table_name='reclasificaciones_cobro' AND column_name = r.c
    ) THEN v_bad := v_bad || ' ' || r.c; END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Faltan columnas:%', v_bad;
  END IF;
  RAISE NOTICE 'CJ-01 listo: reclasificaciones_cobro creada.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
