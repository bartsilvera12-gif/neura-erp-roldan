-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 32 · Ficha de producto: costo en dólares, % de remarcación y descuentos
-- ============================================================================
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────
--   La ficha de artículo del sistema anterior muestra cinco datos que acá no
--   se guardaban:
--
--     Costo $           6.3800   el costo real, en dólares
--     Precio $ al %     20.00    remarcación sobre ese costo
--     Venta $           7.6560   = 6,38 × 1,20
--     Desc. Grupo %      4.00    descuento del rubro
--     Desc. Art %        0.00    descuento del artículo
--
--   El formulario de producto ya calculaba el % de remarcación en vivo
--   (costo ↔ % ↔ precio son reactivos entre sí), pero no lo guardaba: al
--   recargar la pantalla se volvía a deducir del precio y el costo. Deducido
--   alcanza para mostrarlo; no alcanza para volver a aplicarlo cuando se
--   mueve el dólar, que es para lo que sirve.
--
-- ── POR QUÉ EL COSTO EN DÓLARES SE GUARDA Y NO SE CALCULA ─────────────────
--   Hoy el costo en dólares de los informes sale de dividir el costo en
--   guaraníes por la última cotización. Mientras el dólar no se mueva da lo
--   mismo. Cuando se mueve, deja de dar: un caño comprado a 6.400 pasa a
--   figurar como si hubiera costado otra cosa, porque la cuenta se rehace con
--   la cotización de hoy.
--
--   Para mercadería importada el dato cierto es el de la factura del
--   proveedor, que viene en dólares. Guardarlo es lo que permite responder
--   "¿cuánto me costó de verdad?" sin que la respuesta cambie sola.
--
-- ── EL PRECIO DE VENTA SIGUE SIENDO EL QUE ESTÁ CARGADO ───────────────────
--   Estas columnas NO hacen que el precio se recalcule solo. Un precio que se
--   mueve en cada lectura haría que una venta de ayer y una de hoy den
--   distinto sin que nadie haya tocado nada, y Caja, Presupuestos y los
--   informes empezarían a moverse solos.
--
--   Lo que se guarda son los INSUMOS del precio. Para aplicarlos en masa
--   cuando cambia la cotización está el Estudio de precios, que ya existe,
--   deja historial y pide confirmación antes de escribir.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.productos') IS NULL
     OR to_regclass('roldanerp.categorias_productos') IS NULL THEN
    RAISE EXCEPTION 'Faltan roldanerp.productos o categorias_productos. Correr antes el script 01.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Producto
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.productos
  ADD COLUMN IF NOT EXISTS costo_usd      numeric NULL,
  ADD COLUMN IF NOT EXISTS markup_pct     numeric NULL,
  ADD COLUMN IF NOT EXISTS descuento_pct  numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN roldanerp.productos.costo_usd IS
  'Costo unitario en dolares, como vino en la factura del proveedor. NULL = '
  'no se compra en dolares; los informes caen a dividir el costo en guaranies '
  'por la ultima cotizacion.';
COMMENT ON COLUMN roldanerp.productos.markup_pct IS
  'Porcentaje de remarcacion sobre el costo con el que se armo el precio. Es '
  'el "Precio Gs. al %" del sistema anterior. No se aplica solo: sirve para '
  'volver a calcular el precio desde el Estudio de precios.';
COMMENT ON COLUMN roldanerp.productos.descuento_pct IS
  'Descuento propio del articulo, en porcentaje. "Desc. Art %".';

-- Un costo en dolares de cero o negativo no es un costo; es un campo a medio
-- llenar que despues divide mal todos los informes que lo toquen.
ALTER TABLE roldanerp.productos DROP CONSTRAINT IF EXISTS productos_costo_usd_chk;
ALTER TABLE roldanerp.productos
  ADD CONSTRAINT productos_costo_usd_chk CHECK (costo_usd IS NULL OR costo_usd > 0);

-- El descuento se expresa 0..100. Un 150 no es "muy barato", es un error de
-- carga que regalaria mercaderia y encima con el signo cambiado.
ALTER TABLE roldanerp.productos DROP CONSTRAINT IF EXISTS productos_descuento_pct_chk;
ALTER TABLE roldanerp.productos
  ADD CONSTRAINT productos_descuento_pct_chk CHECK (descuento_pct >= 0 AND descuento_pct <= 100);

-- ---------------------------------------------------------------------------
-- 2) Rubro
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.categorias_productos
  ADD COLUMN IF NOT EXISTS descuento_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN roldanerp.categorias_productos.descuento_pct IS
  '"Desc. Grupo %": descuento que aplica a todos los articulos del rubro. El '
  'descuento propio del articulo manda sobre este cuando esta cargado.';

ALTER TABLE roldanerp.categorias_productos DROP CONSTRAINT IF EXISTS categorias_descuento_pct_chk;
ALTER TABLE roldanerp.categorias_productos
  ADD CONSTRAINT categorias_descuento_pct_chk CHECK (descuento_pct >= 0 AND descuento_pct <= 100);

-- ---------------------------------------------------------------------------
-- 3) Backfill del % de remarcación
-- ---------------------------------------------------------------------------
--   Se deduce del costo y el precio que ya están cargados, que es la misma
--   cuenta que el formulario venía haciendo en pantalla. Solo donde los dos
--   son mayores que cero: sin costo no hay remarcación que calcular, y con
--   costo cero la division no existe.
--
--   No se pisa un valor ya cargado: si alguien corre el script dos veces
--   despues de haber ajustado un porcentaje a mano, el ajuste queda.
UPDATE roldanerp.productos p
   SET markup_pct = round(((p.precio_venta - p.costo_promedio) / p.costo_promedio * 100)::numeric, 2)
 WHERE p.markup_pct IS NULL
   AND COALESCE(p.costo_promedio, 0) > 0
   AND COALESCE(p.precio_venta, 0) > 0;

-- ---------------------------------------------------------------------------
-- 4) Verificación
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_falta text;
  v_con_markup int;
  v_total int;
BEGIN
  SELECT string_agg(c.col, ', ') INTO v_falta
    FROM (VALUES
      ('productos','costo_usd'), ('productos','markup_pct'), ('productos','descuento_pct'),
      ('categorias_productos','descuento_pct')
    ) AS c(tabla, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'roldanerp' AND table_name = c.tabla AND column_name = c.col
   );
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'No se crearon las columnas: %', v_falta;
  END IF;

  SELECT count(*) FILTER (WHERE markup_pct IS NOT NULL), count(*)
    INTO v_con_markup, v_total
    FROM roldanerp.productos;
  RAISE NOTICE 'Listo. % de % productos quedaron con su %% de remarcacion calculado.', v_con_markup, v_total;
  RAISE NOTICE 'El costo en dolares arranca vacio: se carga por producto, o se importa.';
END
$verif$;

NOTIFY pgrst, 'reload schema';
