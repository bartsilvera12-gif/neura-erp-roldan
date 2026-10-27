-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 35 · Autorización de descuentos por encima del tope
-- ============================================================================
--
-- QUÉ RESUELVE
--   El tope de descuento frena al vendedor, pero no había forma de levantarlo
--   para una venta puntual. La única salida era que un administrador le subiera
--   el tope —y después se acordara de bajarlo— o que registrara la venta él.
--   Las dos terminan igual: el tope deja de significar algo.
--
--   Ahora el vendedor pide, el administrador recibe el pedido y contesta, y la
--   venta sale con el descuento aprobado. Queda registrado quién autorizó qué.
--
-- POR QUÉ LA SOLICITUD NO APUNTA A UNA VENTA
--   Cuando se pide la autorización la venta todavía no existe: está a medio
--   cargar en la pantalla de Caja. Por eso la solicitud guarda el producto, la
--   cantidad y los precios, y recién cuando la venta se registra se la marca
--   como usada con el id de esa venta.
--
-- POR QUÉ VENCE
--   Una autorización sin vencimiento es un permiso permanente que nadie
--   recuerda haber dado. A los 15 minutos ya no sirve: si el cliente se fue y
--   vuelve mañana, se pide de nuevo. Es tiempo de sobra para el mostrador y
--   poco para que quede dando vueltas.
--
-- POR QUÉ SE USA UNA SOLA VEZ
--   `estado` pasa a 'usada' con la venta que la consumió. Sin eso, una
--   autorización del 30% aprobada una vez serviría para vender todo el día al
--   30%, que es exactamente lo que el tope quería evitar.
--
-- Requiere 01 y 02 corridos. Solo escribe en `roldanerp`. Idempotente.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.usuarios') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.usuarios`.';
  END IF;
  IF to_regclass('roldanerp.productos') IS NULL THEN
    RAISE EXCEPTION 'No existe `roldanerp.productos`.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.solicitudes_descuento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  sucursal_id        uuid NULL,

  -- Quién pide. El nombre se guarda como copia: si mañana se renombra al
  -- usuario, el historial tiene que seguir diciendo quién pidió en su momento.
  solicitante_id     uuid NOT NULL,
  solicitante_nombre text NULL,

  -- Sobre qué. Mismo criterio de copia que arriba.
  producto_id        uuid NULL,
  producto_nombre    text NOT NULL,
  sku                text NULL,
  cantidad           numeric NOT NULL DEFAULT 1,
  precio_lista       numeric NOT NULL DEFAULT 0,
  precio_pedido      numeric NOT NULL DEFAULT 0,
  descuento_pct      numeric NOT NULL,
  tope_pct           numeric NULL,
  motivo             text NULL,

  estado             text NOT NULL DEFAULT 'pendiente',

  -- Quién contestó.
  resuelta_por_id     uuid NULL,
  resuelta_por_nombre text NULL,
  resuelta_at         timestamptz NULL,
  respuesta_motivo    text NULL,

  -- Con qué venta se consumió.
  usada_en_venta_id  uuid NULL,
  usada_at           timestamptz NULL,

  expira_at          timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT solicitudes_descuento_estado_chk
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'usada')),
  CONSTRAINT solicitudes_descuento_pct_chk
    CHECK (descuento_pct >= 0 AND descuento_pct <= 100)
);

-- La pantalla del administrador pregunta siempre lo mismo: qué hay pendiente
-- en esta empresa. Y la de Caja: cómo viene lo mío.
CREATE INDEX IF NOT EXISTS solicitudes_descuento_pendientes_idx
  ON roldanerp.solicitudes_descuento (empresa_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS solicitudes_descuento_solicitante_idx
  ON roldanerp.solicitudes_descuento (empresa_id, solicitante_id, estado);

COMMENT ON TABLE roldanerp.solicitudes_descuento IS
  'Pedidos de descuento por encima del tope del vendedor. El administrador aprueba o rechaza; la aprobación vale una sola venta y vence a los 15 minutos.';
COMMENT ON COLUMN roldanerp.solicitudes_descuento.estado IS
  'pendiente | aprobada | rechazada | usada. Una aprobada y vencida sigue diciendo aprobada: el vencimiento se mide contra expira_at, no cambiando el estado, para que el historial no mienta sobre qué contestó el administrador.';

-- ---------------------------------------------------------------------------
-- Chequeo final
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF to_regclass('roldanerp.solicitudes_descuento') IS NULL THEN
    RAISE EXCEPTION 'No se creo solicitudes_descuento';
  END IF;
  RAISE NOTICE 'Listo: solicitudes_descuento creada.';
  RAISE NOTICE 'El vendedor pide desde Caja; el administrador contesta desde la campana del encabezado.';
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
