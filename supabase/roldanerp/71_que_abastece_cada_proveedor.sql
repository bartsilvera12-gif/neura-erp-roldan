-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 71 · Qué abastece cada proveedor
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Agregar opción en proveedores para seleccionar múltiples tipos de
--   productos que pueden abastecer (no solo rubros)."
--
-- ── QUÉ HABÍA Y POR QUÉ NO ALCANZA ─────────────────────────────────────────
--   Ya existe `proveedor_categoria_rel`, que ata el proveedor a
--   `proveedor_categorias`: una taxonomía PROPIA de proveedores, con una sola
--   fila cargada ("CATE PRUEBA"). Sirve para agrupar proveedores entre sí.
--
--   Lo que no existía es el vínculo con lo que de verdad se compra: los 70
--   RUBROS DE PRODUCTO (`categorias_productos`: FERRETERIA, CHAPA TERMOPANEL,
--   CAÑOS CUADRADOS…) y los artículos puntuales.
--
--   Sin ese vínculo, al armar una orden de compra o pedir cotizaciones el
--   sistema no tiene con qué contestar "¿a quién le pido chapa?". Hoy ninguno
--   de los 1.002 artículos tiene proveedor principal cargado, así que la
--   pregunta no tiene respuesta por ningún lado.
--
-- ── POR QUÉ RUBRO *Y* ARTÍCULO EN LA MISMA TABLA ───────────────────────────
--   "No solo rubros": la mayoría de los proveedores abastece rubros enteros,
--   pero algunos traen un artículo puntual que no define su rubro —el
--   importador que trae una sola marca de disco—. Separarlos en dos tablas
--   obligaría a consultar las dos y unirlas en cada pantalla.
--
--   Una fila es una cosa O la otra, nunca las dos: lo garantiza el CHECK.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.proveedores') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.proveedores.';
  END IF;
  IF to_regclass('roldanerp.categorias_productos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.categorias_productos (los rubros de producto).';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.proveedor_abastece (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  proveedor_id uuid NOT NULL,
  -- Un rubro entero de productos.
  categoria_id uuid,
  -- O un artículo puntual.
  producto_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Una fila es un rubro O un artículo. Las dos a la vez no significaría nada,
  -- y ninguna sería una fila vacía.
  CONSTRAINT proveedor_abastece_uno_u_otro CHECK (
    (categoria_id IS NOT NULL AND producto_id IS NULL) OR
    (categoria_id IS NULL AND producto_id IS NOT NULL)
  )
);

COMMENT ON TABLE roldanerp.proveedor_abastece IS
  'Qué puede traer cada proveedor: rubros de producto enteros o artículos '
  'puntuales. Es lo que contesta "¿a quién le pido chapa?" al armar una orden '
  'de compra o pedir cotizaciones. Distinto de proveedor_categoria_rel, que '
  'clasifica al proveedor en la taxonomía propia de proveedores.';

-- Sin esto, tildar dos veces el mismo rubro crearía filas repetidas y el
-- proveedor aparecería duplicado en las sugerencias.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedor_abastece_rubro
  ON roldanerp.proveedor_abastece (empresa_id, proveedor_id, categoria_id)
  WHERE categoria_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedor_abastece_producto
  ON roldanerp.proveedor_abastece (empresa_id, proveedor_id, producto_id)
  WHERE producto_id IS NOT NULL;

-- La pregunta que más se hace: dado un rubro, qué proveedores lo traen.
CREATE INDEX IF NOT EXISTS idx_proveedor_abastece_categoria
  ON roldanerp.proveedor_abastece (empresa_id, categoria_id)
  WHERE categoria_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_abastece_producto
  ON roldanerp.proveedor_abastece (empresa_id, producto_id)
  WHERE producto_id IS NOT NULL;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.proveedores)                                  AS proveedores,
  (SELECT count(DISTINCT proveedor_id) FROM roldanerp.proveedor_abastece)       AS con_algo_cargado,
  (SELECT count(*) FROM roldanerp.proveedor_abastece WHERE categoria_id IS NOT NULL) AS vinculos_por_rubro,
  (SELECT count(*) FROM roldanerp.proveedor_abastece WHERE producto_id IS NOT NULL)  AS vinculos_por_articulo,
  (SELECT count(*) FROM roldanerp.categorias_productos)                         AS rubros_de_producto;
