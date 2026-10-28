-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 38 · Nota interna del presupuesto, y la marca de "falta material"
-- ============================================================================
--
-- QUÉ FALTABA
--   El presupuesto tiene dos campos de texto —`condiciones_comerciales` y
--   `observaciones`— y los DOS salen impresos en el PDF que se le manda al
--   cliente. Así que no había dónde anotar lo que es asunto de la casa: que
--   falta material, que hay que pedirle al proveedor, que el precio se dio
--   contra una promesa de entrega que todavía no está firme.
--
--   Escribir eso en observaciones significa mandárselo al cliente. Y no
--   escribirlo significa que el que atiende mañana no se entera.
--
-- QUÉ AGREGA
--   `nota_interna` — texto que se ve en el sistema y NUNCA se imprime.
--   `falta_material` — la marca que se lee de un vistazo en el listado, sin
--     tener que abrir cada presupuesto para enterarse.
--
--   Son dos cosas y no una: el texto explica, la marca avisa. Con solo el
--   texto habría que abrir uno por uno para saber cuáles están trabados; con
--   solo la marca no se sabría qué falta ni a quién se le pidió.
--
-- LO QUE NO SE IMPRIME ES UNA DECISIÓN, NO UN OLVIDO
--   El PDF no toca estas columnas, a propósito. Si alguna vez hay que mostrar
--   algo de esto al cliente, va en observaciones, que para eso está.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.presupuestos`.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS nota_interna text NULL;

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS falta_material boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN roldanerp.presupuestos.nota_interna IS
  'Nota para adentro: qué falta, a quién se le pidió, qué hay que revisar. NO se imprime en el PDF del cliente.';
COMMENT ON COLUMN roldanerp.presupuestos.falta_material IS
  'Marca que este presupuesto no se puede cumplir con lo que hay. Se ve en el listado. NO se imprime.';

-- Para encontrar rápido los trabados sin recorrer todo.
CREATE INDEX IF NOT EXISTS presupuestos_falta_material_idx
  ON roldanerp.presupuestos (empresa_id, falta_material)
  WHERE falta_material;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE faltan text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos' AND column_name='nota_interna')
  THEN faltan := faltan || 'nota_interna '; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos' AND column_name='falta_material')
  THEN faltan := faltan || 'falta_material '; END IF;

  IF faltan <> '' THEN RAISE EXCEPTION 'No se crearon: %', faltan; END IF;
  RAISE NOTICE 'Listo. La nota interna y la marca de falta de material no se imprimen nunca en el PDF.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
