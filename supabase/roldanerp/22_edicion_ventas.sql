-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 22 · Punto 2.2 · Edición de ventas con registro de qué cambió
-- ============================================================================
--
-- QUÉ PIDE EL PUNTO
--   "Permitir editar una venta únicamente a administradores, registrando quién
--   la modificó, cuándo y qué cambió."
--
-- QUÉ TRAE ESTE SCRIPT
--   1. Dos orígenes nuevos de movimiento, para que el stock que se mueve por
--      una edición se distinga del que se mueve por una anulación.
--   2. `ventas_ediciones`: el historial de cambios, campo por campo.
--
-- POR QUÉ ORÍGENES PROPIOS Y NO REUSAR 'anulacion_venta'
--   Editar una venta devuelve al stock lo que tenía la versión vieja y vuelve
--   a sacar lo de la nueva. Registrar la devolución como anulación haría que
--   el kardex, el historial y la valoración lean una anulación que no existió:
--   la venta sigue viva, con su mismo número. Con un origen propio, cada
--   pantalla puede decir la verdad —"esto se movió porque se editó la
--   venta"— sin inventar una operación.
--
-- POR QUÉ SE GUARDA EL DIFF Y NO UNA COPIA ENTERA
--   Una copia de la venta anterior responde "cómo era"; el pedido es saber
--   "QUÉ CAMBIÓ". Con el diff, abrir el historial muestra en una línea que el
--   total pasó de 500.000 a 450.000, en vez de obligar a comparar dos
--   versiones completas a ojo. Los totales de antes y después se guardan
--   aparte porque son la pregunta más frecuente.
--
-- NOTA SOBRE FACTURAS
--   El sistema NO bloquea editar una venta ya facturada: es una decisión del
--   cliente, tomada explícitamente. Se deja constancia en `tenia_factura`
--   para que después se pueda saber cuáles fueron.
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

-- ---------------------------------------------------------------------------
-- 1) Orígenes de movimiento para la edición
-- ---------------------------------------------------------------------------
-- Se recrea el CHECK preservando los 9 valores que ya acepta y sumando los 2
-- nuevos. Primero se verifica que no haya en la tabla ningún origen fuera de
-- la lista: si lo hubiera, el ALTER fallaría a mitad y es mejor saberlo acá.
DO $origen$
DECLARE v_raros text;
BEGIN
  SELECT string_agg(DISTINCT origen, ', ') INTO v_raros
    FROM roldanerp.movimientos_inventario
   WHERE origen IS NOT NULL
     AND origen <> ALL (ARRAY[
       'compra','venta','ajuste_manual','inventario_inicial',
       'anulacion_venta','anulacion_compra','produccion',
       'devolucion_venta','devolucion_proveedor',
       'transferencia_salida','transferencia_entrada',
       'edicion_venta','edicion_venta_reversa'
     ]);
  IF v_raros IS NOT NULL THEN
    RAISE EXCEPTION 'Hay movimientos con origen fuera de la lista: %. Revisar antes de seguir.', v_raros;
  END IF;
END
$origen$;

ALTER TABLE roldanerp.movimientos_inventario
  DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;
ALTER TABLE roldanerp.movimientos_inventario
  ADD CONSTRAINT movimientos_inventario_origen_check CHECK (
    origen = ANY (ARRAY[
      'compra','venta','ajuste_manual','inventario_inicial',
      'anulacion_venta','anulacion_compra','produccion',
      -- Las devoluciones ya las escribe el código (devoluciones a proveedor
      -- registran SALIDA con origen='devolucion_proveedor'). Sin estos dos
      -- valores el CHECK pasa al correr el script y recién revienta la primera
      -- vez que alguien carga una devolución.
      'devolucion_venta','devolucion_proveedor',
      'transferencia_salida','transferencia_entrada',
      'edicion_venta','edicion_venta_reversa'
    ])
  );

-- ---------------------------------------------------------------------------
-- 2) Historial de ediciones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.ventas_ediciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  venta_id       uuid NOT NULL,
  -- Snapshot: si la venta se renumerara o se borrara, el historial tiene que
  -- seguir diciendo de cuál comprobante habla.
  venta_numero   text NULL,

  fecha          timestamptz NOT NULL DEFAULT now(),
  usuario_id     uuid NULL,
  usuario_nombre text NULL,

  -- Qué cambió: [{campo, antes, despues}]. Ver el comentario de arriba.
  cambios        jsonb NOT NULL DEFAULT '[]'::jsonb,

  total_antes    numeric NULL,
  total_despues  numeric NULL,

  -- La venta ya tenía factura emitida cuando se editó.
  tenia_factura  boolean NOT NULL DEFAULT false,

  motivo         text NOT NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ventas_ediciones_venta_fk
    FOREIGN KEY (venta_id) REFERENCES roldanerp.ventas(id) ON DELETE RESTRICT,

  -- Sin motivo el registro no sirve para auditar: dice que algo cambió pero
  -- no por qué, que es justamente lo que se va a preguntar después.
  CONSTRAINT ventas_ediciones_motivo_chk CHECK (btrim(motivo) <> ''),
  -- Una edición que no cambió nada no es una edición.
  CONSTRAINT ventas_ediciones_cambios_chk CHECK (jsonb_array_length(cambios) > 0)
);

COMMENT ON TABLE roldanerp.ventas_ediciones IS
  'Punto 2.2. Historial de ediciones de ventas: quien, cuando, por que y QUE cambio (diff campo por campo).';
COMMENT ON COLUMN roldanerp.ventas_ediciones.cambios IS
  'Arreglo [{campo, antes, despues}]. Se guarda el diff y no una copia entera porque la pregunta es que cambio, no como era.';
COMMENT ON COLUMN roldanerp.ventas_ediciones.tenia_factura IS
  'La venta ya tenia factura emitida al editarse. No bloquea: queda la constancia.';

CREATE INDEX IF NOT EXISTS ventas_ediciones_venta_idx
  ON roldanerp.ventas_ediciones (empresa_id, venta_id, fecha DESC);

CREATE INDEX IF NOT EXISTS ventas_ediciones_fecha_idx
  ON roldanerp.ventas_ediciones (empresa_id, fecha DESC);

-- Las que tocaron una venta facturada son las que va a querer revisar el
-- contador.
CREATE INDEX IF NOT EXISTS ventas_ediciones_facturadas_idx
  ON roldanerp.ventas_ediciones (empresa_id, fecha DESC)
  WHERE tenia_factura;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_chk text;
BEGIN
  IF to_regclass('roldanerp.ventas_ediciones') IS NULL THEN
    RAISE EXCEPTION 'No se creo roldanerp.ventas_ediciones';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_chk
    FROM pg_constraint
   WHERE conname = 'movimientos_inventario_origen_check'
     AND conrelid = 'roldanerp.movimientos_inventario'::regclass;

  IF v_chk IS NULL OR position('edicion_venta_reversa' in v_chk) = 0 THEN
    RAISE EXCEPTION 'El CHECK de origen no quedo con los valores de edicion: %', v_chk;
  END IF;

  RAISE NOTICE '2.2 listo: ventas_ediciones creada y origen acepta edicion_venta / edicion_venta_reversa.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
