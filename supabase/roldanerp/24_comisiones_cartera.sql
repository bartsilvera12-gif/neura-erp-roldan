-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 24 · Módulo 4 · Vendedores, cartera y comisiones
-- ============================================================================
--
-- Base de los puntos 4.1 (cartera), 4.4 (comisión por rentabilidad),
-- 4.5 (configuración por rubro y tipo) y 4.6 (informe).
--
-- ── CÓMO SE CALCULA LA COMISIÓN (4.4) ──────────────────────────────────────
--   El pedido dice "calcular comisiones proporcionalmente a la remarcación o
--   margen. Si hay descuento que reduce la rentabilidad, ajustar también la
--   comisión".
--
--   Se aplica el porcentaje sobre la GANANCIA, no sobre la facturación:
--
--       comisión = porcentaje × (venta sin IVA − costo)
--
--   Con eso el ajuste por descuento sale solo, sin ninguna regla extra: si el
--   vendedor baja el precio, baja la ganancia, y la comisión baja con ella. Un
--   porcentaje sobre la facturación haría lo contrario — premiaría vender
--   barato, porque la facturación con descuento sigue entrando entera.
--
--   Ejemplo: costo 100.000, precio de lista 150.000.
--     sin descuento   → ganancia 50.000 → comisión al 10% = 5.000
--     con 10% de desc → ganancia 35.000 → comisión al 10% = 3.500
--
-- ── QUÉ PORCENTAJE SE APLICA (4.5) ─────────────────────────────────────────
--   Las reglas van de lo específico a lo general, y gana la más específica:
--     1. tipo de vendedor + rubro
--     2. solo rubro          (cualquier tipo de vendedor)
--     3. solo tipo           (cualquier rubro)
--     4. el porcentaje base del tipo de vendedor
--     5. 0 si no hay nada configurado
--
--   NULL significa "cualquiera", no "ninguno". Por eso las dos columnas de la
--   regla admiten NULL en vez de obligar a cargar una fila por cada
--   combinación posible, que serían decenas para decir siempre lo mismo.
--
-- ── LA CARTERA NO SE BORRA, SE CALCULA (4.1) ───────────────────────────────
--   "Mantenerlo 30 días en su cartera; si no concreta otra operación en ese
--   plazo, liberarlo automáticamente."
--
--   Un proceso que vacíe `vendedor_usuario_id` a los 30 días cumpliría al pie
--   de la letra y sería un error: borra quién lo venía atendiendo, que es
--   justo el dato que sirve para reasignarlo o para discutir una comisión del
--   mes pasado. Además, si el cliente vuelve al día siguiente, nadie sabe a
--   quién correspondía.
--
--   Acá queda `cartera_desde`, la fecha de la última operación. El cliente
--   está EN CARTERA mientras no pasen los días configurados, y pasa a estar
--   LIBRE solo. Es reversible, no pierde información, y el vendedor sigue
--   figurando como el último que lo atendió.
--
-- Requiere 01, 02 y 05 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.usuarios`.';
  END IF;
  IF to_regclass('roldanerp.clientes') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.clientes`.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1) Tipos de vendedor (4.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.tipos_vendedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  nombre           text NOT NULL,
  -- Porcentaje sobre la ganancia cuando ninguna regla por rubro aplica.
  porcentaje_base  numeric NOT NULL DEFAULT 0,
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tipos_vendedor_nombre_chk CHECK (btrim(nombre) <> ''),
  -- Más de 100% de la ganancia significaría pagar por vender. Se acota para
  -- que un dedazo no genere una liquidación absurda.
  CONSTRAINT tipos_vendedor_pct_chk CHECK (porcentaje_base >= 0 AND porcentaje_base <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS tipos_vendedor_nombre_uq
  ON roldanerp.tipos_vendedor (empresa_id, upper(btrim(nombre)));

COMMENT ON TABLE roldanerp.tipos_vendedor IS
  'Punto 4.5. Tipos de vendedor (interno, externo, mostrador...) con su porcentaje base sobre la ganancia.';

-- ---------------------------------------------------------------------------
-- 2) Reglas por rubro y tipo (4.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.comisiones_reglas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  -- NULL = cualquier tipo de vendedor.
  tipo_vendedor_id   uuid NULL REFERENCES roldanerp.tipos_vendedor(id) ON DELETE CASCADE,
  -- NULL = cualquier rubro de producto.
  categoria_id       uuid NULL,
  porcentaje         numeric NOT NULL,
  activo             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comisiones_reglas_pct_chk CHECK (porcentaje >= 0 AND porcentaje <= 100)
);

-- Una sola regla por combinación. El índice usa coalesce porque en Postgres
-- dos NULL no se consideran iguales, así que sin esto se podrían cargar
-- varias reglas "cualquier tipo / cualquier rubro" y ninguna ganaría.
CREATE UNIQUE INDEX IF NOT EXISTS comisiones_reglas_combo_uq
  ON roldanerp.comisiones_reglas (
    empresa_id,
    coalesce(tipo_vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(categoria_id,     '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMENT ON TABLE roldanerp.comisiones_reglas IS
  'Punto 4.5. Porcentaje de comision por rubro y tipo de vendedor. NULL = cualquiera. Gana la regla mas especifica.';

-- ---------------------------------------------------------------------------
-- 3) Configuración general (4.1 y 4.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roldanerp.comisiones_config (
  empresa_id     uuid PRIMARY KEY,
  -- 4.1: cuántos días se mantiene un cliente en la cartera sin operaciones.
  dias_cartera   integer NOT NULL DEFAULT 30,
  -- 4.4: sobre qué se calcula. 'margen' aplica el % sobre la ganancia;
  -- 'facturacion' sobre la venta neta. El pedido pide margen; queda la opción
  -- por si más adelante quieren comparar.
  base_calculo   text NOT NULL DEFAULT 'margen',
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comisiones_config_dias_chk CHECK (dias_cartera >= 1 AND dias_cartera <= 365),
  CONSTRAINT comisiones_config_base_chk CHECK (base_calculo IN ('margen', 'facturacion'))
);

COMMENT ON COLUMN roldanerp.comisiones_config.base_calculo IS
  'Punto 4.4. margen = el % se aplica sobre la ganancia, asi un descuento baja la comision solo. facturacion = sobre la venta neta.';

-- Una fila por empresa, con los valores que pide el pedido.
INSERT INTO roldanerp.comisiones_config (empresa_id)
SELECT e.id FROM roldanerp.empresas e
 WHERE NOT EXISTS (SELECT 1 FROM roldanerp.comisiones_config c WHERE c.empresa_id = e.id);

-- ---------------------------------------------------------------------------
-- 4) Columnas nuevas
-- ---------------------------------------------------------------------------
ALTER TABLE roldanerp.usuarios
  ADD COLUMN IF NOT EXISTS tipo_vendedor_id uuid NULL;

COMMENT ON COLUMN roldanerp.usuarios.tipo_vendedor_id IS
  'Punto 4.5. Tipo de vendedor del usuario. NULL = no es vendedor o no se le asigno tipo.';

ALTER TABLE roldanerp.clientes
  ADD COLUMN IF NOT EXISTS cartera_desde timestamptz NULL;

COMMENT ON COLUMN roldanerp.clientes.cartera_desde IS
  'Punto 4.1. Fecha de la ultima operacion que renovo la cartera. El cliente esta en cartera mientras no pasen comisiones_config.dias_cartera. NULL = nunca operó con su vendedor asignado.';

-- Arranque: los clientes que ya tienen vendedor asignado toman la fecha de su
-- última venta. Sin esto, el primer día quedarían todos "libres" aunque se les
-- haya vendido ayer.
UPDATE roldanerp.clientes c
   SET cartera_desde = u.ultima
  FROM (
    SELECT cliente_id, max(fecha) AS ultima
      FROM roldanerp.ventas
     WHERE cliente_id IS NOT NULL
       AND COALESCE(estado, 'completada') <> 'anulada'
     GROUP BY cliente_id
  ) u
 WHERE u.cliente_id = c.id
   AND c.cartera_desde IS NULL
   AND c.vendedor_usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clientes_cartera_idx
  ON roldanerp.clientes (empresa_id, vendedor_usuario_id, cartera_desde DESC);

COMMIT;

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
DECLARE v_n int;
BEGIN
  FOR v_n IN
    SELECT 1 FROM unnest(ARRAY['tipos_vendedor','comisiones_reglas','comisiones_config']) t
     WHERE to_regclass('roldanerp.' || t) IS NULL
  LOOP
    RAISE EXCEPTION 'Falta alguna tabla del modulo 4';
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='clientes' AND column_name='cartera_desde'
  ) THEN
    RAISE EXCEPTION 'No se creo clientes.cartera_desde';
  END IF;

  SELECT count(*) INTO v_n FROM roldanerp.clientes WHERE cartera_desde IS NOT NULL;
  RAISE NOTICE 'Modulo 4 listo: tablas creadas, % cliente(s) con cartera inicializada.', v_n;
END
$check$;

NOTIFY pgrst, 'reload schema';
