-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 20 · Punto 1.5 (y base del punto 7) · Tipos de cambio con historial
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Las compras ya guardan `moneda`, `tipo_cambio` y `costo_unitario_original`,
--   así que la cotización usada en cada factura YA queda conservada. Lo que
--   falta es lo otro que pide el punto 1.5: "tomar el tipo de cambio VIGENTE
--   al cargar la factura". Hoy se tipea de memoria cada vez, y dos personas
--   cargando compras el mismo día pueden usar cotizaciones distintas sin que
--   nadie se entere.
--
--   Esta tabla es también la base del punto 7 (indicadores editables en el
--   Dashboard e historial por fecha y hora con usuario responsable).
--
-- COMPRADOR Y VENDEDOR
--   Se guardan los dos, como pide el punto 7.1. Una compra al exterior se
--   paga al tipo VENDEDOR (el banco te vende los dólares); una venta cobrada
--   en dólares se convierte al COMPRADOR. Guardar un solo número obligaría a
--   elegir cuál de las dos operaciones queda mal.
--
-- POR QUÉ NO SE PISA UNA COTIZACIÓN YA USADA
--   El punto 7.2 lo pide explícitamente, y la razón es concreta: si se
--   corrigiera la cotización de ayer, el costo de todo lo comprado ayer
--   cambiaría retroactivamente y los informes dejarían de coincidir con las
--   facturas en papel. Cada cotización es un asiento nuevo con su fecha y
--   hora; corregir es cargar otra, no editar la anterior. Por eso no hay
--   UPDATE ni DELETE previstos y la tabla es append-only.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.empresas') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.empresas`.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.tipos_cambio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,

  -- Siempre contra el guaraní. Se deja explícito para no tener que adivinarlo
  -- si mañana entra el real o el peso.
  moneda       text NOT NULL DEFAULT 'USD',

  -- Cuántos guaraníes por una unidad de `moneda`.
  compra       numeric NOT NULL,
  venta        numeric NOT NULL,

  -- Desde cuándo rige. Normalmente now(), pero se permite cargar una
  -- cotización con la fecha y hora reales si se registra más tarde.
  vigente_desde timestamptz NOT NULL DEFAULT now(),

  usuario_id     uuid NULL,
  usuario_nombre text NULL,
  observacion    text NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Una cotización de 0 o negativa divide mal todos los costos que toque.
  CONSTRAINT tipos_cambio_compra_chk CHECK (compra > 0),
  CONSTRAINT tipos_cambio_venta_chk  CHECK (venta > 0),
  -- El vendedor nunca es menor que el comprador: si se cargan al revés, los
  -- costos de importación salen por debajo de lo que realmente se pagó.
  CONSTRAINT tipos_cambio_orden_chk  CHECK (venta >= compra),
  CONSTRAINT tipos_cambio_moneda_chk CHECK (btrim(moneda) <> '')
);

COMMENT ON TABLE roldanerp.tipos_cambio IS
  'Punto 1.5 y 7. Cotizaciones con fecha, hora y usuario. Append-only: corregir es cargar otra, nunca editar la anterior, porque las operaciones ya hechas usaron la vieja.';
COMMENT ON COLUMN roldanerp.tipos_cambio.compra IS
  'Tipo comprador: guaranies por unidad de moneda cuando se RECIBEN divisas.';
COMMENT ON COLUMN roldanerp.tipos_cambio.venta IS
  'Tipo vendedor: guaranies por unidad de moneda cuando se COMPRAN divisas. Es el que usa una compra al exterior.';
COMMENT ON COLUMN roldanerp.tipos_cambio.vigente_desde IS
  'Desde cuando rige. La cotizacion vigente es la de vigente_desde mas reciente que no sea futura.';

-- La consulta que corre en cada carga de compra: "la última vigente".
CREATE INDEX IF NOT EXISTS tipos_cambio_vigente_idx
  ON roldanerp.tipos_cambio (empresa_id, moneda, vigente_desde DESC);

-- ---------------------------------------------------------------------------
-- Semilla: la última cotización que se haya usado en una compra
-- ---------------------------------------------------------------------------
-- Arrancar la tabla vacía dejaría el campo sin pre-cargar justo la primera
-- vez. La última compra en dólares ya tiene una cotización real y escrita por
-- alguien, así que sirve de punto de partida. Se carga con la fecha de esa
-- compra, no con la de hoy, para no afirmar que esa cotización es de ahora.
INSERT INTO roldanerp.tipos_cambio (empresa_id, moneda, compra, venta, vigente_desde, observacion)
SELECT c.empresa_id, 'USD', c.tipo_cambio, c.tipo_cambio, c.fecha,
       'Semilla: tomado de la compra ' || COALESCE(c.numero_control, '(sin numero)')
  FROM roldanerp.compras c
  JOIN (
    SELECT empresa_id, max(fecha) AS fecha
      FROM roldanerp.compras
     WHERE moneda = 'USD' AND COALESCE(tipo_cambio, 0) > 0
     GROUP BY empresa_id
  ) u ON u.empresa_id = c.empresa_id AND u.fecha = c.fecha
 WHERE c.moneda = 'USD' AND COALESCE(c.tipo_cambio, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM roldanerp.tipos_cambio t WHERE t.empresa_id = c.empresa_id
   );

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_n int;
BEGIN
  IF to_regclass('roldanerp.tipos_cambio') IS NULL THEN
    RAISE EXCEPTION 'No se creo roldanerp.tipos_cambio';
  END IF;
  SELECT count(*) INTO v_n FROM roldanerp.tipos_cambio;
  RAISE NOTICE '1.5 listo: tipos_cambio creada, % cotizacion(es) cargada(s).', v_n;
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
