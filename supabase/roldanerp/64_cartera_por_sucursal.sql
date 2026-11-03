-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 64 · La cartera de clientes, por sucursal
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Diferenciar cartera de clientes por sucursal."
--
-- ── POR QUÉ NO ALCANZABA CON LA COLUMNA QUE YA HABÍA ───────────────────────
--   La cartera vivía en `clientes.vendedor_usuario_id` + `cartera_desde`: UNA
--   sola respuesta por cliente para toda la empresa. Con dos sucursales eso
--   obliga a que el mismo cliente sea de un solo vendedor en toda la casa,
--   cuando en la práctica el que lo atiende en Casa Central y el que lo
--   atiende en la otra sucursal son dos personas distintas, cada una con su
--   comisión y su plazo de 30 días corriendo por separado.
--
--   Con una sola columna, el segundo que lo atendiera le pisaría la cartera al
--   primero —o no la tendría nunca— y el reloj de los 30 días se reiniciaría
--   con las ventas de la otra sucursal.
--
-- ── QUÉ PASA CON LO QUE YA ESTABA ASIGNADO ─────────────────────────────────
--   Se migra a la sucursal PRINCIPAL, que es donde se viene operando. La otra
--   sucursal arranca con la cartera vacía: todos sus clientes quedan libres
--   para asignar, que es justamente lo que significa "diferenciar".
--
--   `clientes.vendedor_usuario_id` NO se borra. Sigue siendo el vendedor que
--   figura en la ficha del cliente —un dato de la ficha, no de la cartera— y
--   lo leen el listado y el alta de clientes. Borrarlo rompería esas dos
--   pantallas para arreglar una tercera.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.clientes') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.clientes. Correr antes el script 01.';
  END IF;
  IF to_regclass('roldanerp.sucursales') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.sucursales. Correr antes el script de sucursales.';
  END IF;
END
$guard$;

-- ── 1) La cartera ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roldanerp.cliente_cartera (
  empresa_id          uuid NOT NULL,
  cliente_id          uuid NOT NULL,
  sucursal_id         uuid NOT NULL,
  vendedor_usuario_id uuid,
  -- El nombre, congelado. Si el vendedor se da de baja, la cartera del mes
  -- pasado tiene que seguir diciendo quién la atendía.
  vendedor_nombre     text,
  -- Desde cuándo corre el plazo. NULL = liberado a mano: queda constando
  -- quién lo atendía pero el cliente está libre ya mismo.
  cartera_desde       timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, cliente_id, sucursal_id)
);

COMMENT ON TABLE roldanerp.cliente_cartera IS
  'A qué vendedor pertenece cada cliente EN CADA SUCURSAL, con su propio plazo '
  'de permanencia. Sin fila = el cliente está libre en esa sucursal.';

CREATE INDEX IF NOT EXISTS idx_cliente_cartera_vendedor
  ON roldanerp.cliente_cartera (empresa_id, sucursal_id, vendedor_usuario_id);

-- ── 2) Lo ya asignado pasa a la sucursal principal ─────────────────────────
-- Solo si la fila no existe: una corrida posterior no pisa lo que se haya
-- reasignado desde la pantalla.
DO $migra$
DECLARE
  principal uuid;
  movidos   int;
BEGIN
  FOR principal IN
    SELECT DISTINCT ON (empresa_id) id
      FROM roldanerp.sucursales
     WHERE activa IS NOT false
     ORDER BY empresa_id, es_principal DESC NULLS LAST, created_at
  LOOP
    INSERT INTO roldanerp.cliente_cartera
      (empresa_id, cliente_id, sucursal_id, vendedor_usuario_id, vendedor_nombre, cartera_desde)
    SELECT c.empresa_id, c.id, principal, c.vendedor_usuario_id, c.vendedor_asignado, c.cartera_desde
      FROM roldanerp.clientes c
      JOIN roldanerp.sucursales s ON s.id = principal AND s.empresa_id = c.empresa_id
     WHERE c.vendedor_usuario_id IS NOT NULL
       AND c.deleted_at IS NULL
    ON CONFLICT (empresa_id, cliente_id, sucursal_id) DO NOTHING;

    GET DIAGNOSTICS movidos = ROW_COUNT;
    RAISE NOTICE 'Sucursal principal %: % clientes migrados a su cartera.', principal, movidos;
  END LOOP;
END
$migra$;

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT s.nombre AS sucursal,
       count(*) FILTER (WHERE cc.vendedor_usuario_id IS NOT NULL) AS con_vendedor,
       count(*) FILTER (WHERE cc.cartera_desde IS NOT NULL)       AS con_plazo_corriendo
FROM roldanerp.sucursales s
LEFT JOIN roldanerp.cliente_cartera cc ON cc.sucursal_id = s.id
GROUP BY s.id, s.nombre
ORDER BY s.nombre;
