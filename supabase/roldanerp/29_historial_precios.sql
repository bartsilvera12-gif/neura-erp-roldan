-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 29 · Requisito 11.3 · Historial de precios
-- ============================================================================
--
-- "Trazabilidad: usuario, fecha, hora y detalle en cambios, anulaciones,
-- ajustes, transferencias y demás operaciones relevantes."
--
-- ── POR QUÉ ESTA TABLA ────────────────────────────────────────────────────
--   El resto de las operaciones que mueven plata ya dejan rastro: los ajustes
--   de stock (1.4), la edición de ventas (2.2), la anulación de cobros y de
--   anticipos, la reapertura de caja (5.1) y las transferencias (8.1).
--
--   El precio de venta no. Hasta ahora se escribía encima del anterior y el
--   anterior desaparecía. Con el estudio de precios (10.5) eso pasa a ser un
--   problema concreto: un cambio masivo toca cientos de productos de una vez
--   y, sin registro, la pregunta "¿por qué este caño salía 80.000 el mes
--   pasado?" no tiene respuesta, ni siquiera para saber si fue un error.
--
-- ── QUÉ GUARDA Y QUÉ NO ───────────────────────────────────────────────────
--   Guarda el antes, el después, quién, cuándo y con qué regla. No guarda el
--   costo: el costo tiene su propia historia en los movimientos de inventario
--   y duplicarlo acá sería tener dos versiones de lo mismo.
--
--   `lote` agrupa las filas de un mismo cambio masivo. Sin eso, 300 filas con
--   la misma hora serían 300 eventos sueltos en vez de uno solo que se puede
--   leer —o revertir— como una unidad.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.productos. Correr antes el script 01.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.precios_historial (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  sucursal_id    uuid NULL,
  producto_id    uuid NOT NULL,
  -- Snapshot: si el producto se renombra o se borra, el historial tiene que
  -- seguir diciendo de cuál hablaba.
  producto_nombre text NULL,
  producto_sku    text NULL,

  precio_anterior numeric NOT NULL DEFAULT 0,
  precio_nuevo    numeric NOT NULL DEFAULT 0,

  -- Cómo se calculó: 'remarcacion', 'margen', 'ajuste' o 'manual'.
  modo           text NULL,
  -- El % que se pidió, si vino de una regla.
  valor          numeric NULL,
  redondeo       integer NULL,

  -- Agrupa las filas de un mismo cambio masivo.
  lote           uuid NULL,

  usuario_id     uuid NULL,
  usuario_nombre text NULL,
  creado_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT precios_historial_precios_no_negativos
    CHECK (precio_anterior >= 0 AND precio_nuevo >= 0)
);

COMMENT ON TABLE roldanerp.precios_historial IS
  'Cada cambio de precio de venta: antes, después, quién y con qué regla (11.3).';
COMMENT ON COLUMN roldanerp.precios_historial.lote IS
  'Agrupa las filas de un mismo cambio masivo para poder leerlo como un solo evento.';

-- Las dos preguntas que se le hacen a esta tabla: "qué pasó con este
-- producto" y "qué se cambió aquel día".
CREATE INDEX IF NOT EXISTS ix_precios_historial_producto
  ON roldanerp.precios_historial (empresa_id, producto_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_precios_historial_fecha
  ON roldanerp.precios_historial (empresa_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_precios_historial_lote
  ON roldanerp.precios_historial (empresa_id, lote)
  WHERE lote IS NOT NULL;

DO $verif$
DECLARE v_ok boolean;
BEGIN
  SELECT to_regclass('roldanerp.precios_historial') IS NOT NULL INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'No quedo creada roldanerp.precios_historial.';
  END IF;
  RAISE NOTICE '11.3 listo: precios_historial creada.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
