-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 82 · Los códigos que tenía antes un producto
-- ============================================================================
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
--   Un producto cambia de código y la gente lo sigue buscando por el viejo.
--   En Carapeguá el arco de sierra era FASP durante años; al unificarlo con
--   Casa Central pasó a FARSP. Quien lo pide por teléfono dice FASP, quien lo
--   busca en el sistema escribe FASP, y no encuentra nada.
--
--   No es que el código viejo esté mal: es el que está escrito en los papeles,
--   en las estanterías y en la cabeza de la gente. Lo que cambió es cuál usa
--   el sistema de acá en adelante.
--
-- ── POR QUÉ UNA TABLA Y NO UNA COLUMNA ─────────────────────────────────────
--   Porque un producto puede haber tenido más de un código —el interno del
--   sistema viejo y el de referencia, por ejemplo— y porque cada uno dejó de
--   usarse en una fecha distinta. Con una columna se guarda uno solo y se
--   pierde el resto.
--
-- ── ESTO NO CAMBIA NINGÚN DOCUMENTO ────────────────────────────────────────
--   Las ventas y los presupuestos ya guardan el código del día en que se
--   emitieron, en su propia línea: una factura vieja sigue mostrando el código
--   viejo por su cuenta. Esta tabla es solo para BUSCAR.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.productos.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.producto_codigos_anteriores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  producto_id  uuid NOT NULL REFERENCES roldanerp.productos(id) ON DELETE CASCADE,
  -- El código como lo escribía la gente, tal cual.
  codigo       text NOT NULL,
  -- Hasta cuándo se usó. NULL = no se sabe; igual sirve para buscar.
  vigente_hasta date,
  -- De dónde salió: 'migracion_carapegua', 'cambio_manual', etc. Sirve para
  -- saber a quién preguntarle cuando un código no cierra.
  origen       text,
  nota         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.producto_codigos_anteriores IS
  'Códigos que un producto tuvo antes. Son para BUSCAR: la gente sigue '
  'pidiendo las cosas por el código viejo. No cambian ningún documento: las '
  'ventas y los presupuestos ya guardan el código del día que se emitieron.';

-- El mismo código no se carga dos veces para el mismo producto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pca_producto_codigo
  ON roldanerp.producto_codigos_anteriores (empresa_id, producto_id, upper(codigo));

-- La consulta que importa: "alguien escribió FASP, ¿de qué producto era?".
-- Sobre upper(codigo) porque nadie escribe respetando mayúsculas.
CREATE INDEX IF NOT EXISTS idx_pca_codigo
  ON roldanerp.producto_codigos_anteriores (empresa_id, upper(codigo));

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                        AS codigos_viejos,
  count(DISTINCT producto_id)     AS productos_con_codigo_viejo,
  count(*) FILTER (WHERE vigente_hasta IS NOT NULL) AS con_fecha_de_corte
FROM roldanerp.producto_codigos_anteriores;
