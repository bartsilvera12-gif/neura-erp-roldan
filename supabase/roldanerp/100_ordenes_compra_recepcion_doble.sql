-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 100 · Órdenes de compra: «Recibido» con doble confirmación
-- ============================================================================
--
-- POR QUÉ HACE FALTA
--   Pedido del cliente: para dar una orden por recibida tienen que confirmarlo
--   DOS personas. La primera (quien recibe la mercadería) marca «Recibido»;
--   el administrador recibe el aviso en la campana y le da «Aceptar». Hasta
--   que estén las dos, la orden queda «Por confirmar», no recibida.
--
--   Hoy la tabla solo guarda `recibida_at` (script 97): la fecha, no QUIÉN la
--   marcó. Sin estas columnas no hay dónde anotar las dos confirmaciones y el
--   control no se puede hacer.
--
-- QUÉ AGREGA  (6 columnas nuevas, todas NULL)
--   recibida_por_1 / _nombre / _at   la primera confirmación
--   recibida_por_2 / _nombre / _at   la segunda, la del administrador
--
--   El nombre va como copia (snapshot), igual que en cobranzas y pagos: así
--   la orden sigue diciendo quién la recibió aunque después se borre o se
--   renombre el usuario.
--
-- COMPATIBILIDAD CON LO QUE YA HAY
--   - No toca ni borra ningún dato. `recibida_at` se conserva y sigue siendo
--     «cuándo quedó recibida» (ahora, cuándo llegó la segunda confirmación).
--   - Las órdenes que YA están en estado `recibida` quedan como están: el
--     código las sigue mostrando recibidas (se las reconoce porque tienen
--     `estado = 'recibida'` y no tienen `recibida_por_1_at`, o sea que se
--     confirmaron con la regla anterior). No hay que rellenar nada.
--   - La aplicación funciona con o sin este script: si las columnas no están,
--     «Recibido» vuelve al comportamiento de antes (un solo click) y lo avisa.
--     Correrlo es lo que activa la doble confirmación.
--
-- RESPALDO
--   No hace falta respaldo para correrlo: solo agrega columnas vacías.
--   Si igual querés uno, alcanza con:
--     CREATE TABLE roldanerp._bk_ordenes_compra_100 AS
--       SELECT * FROM roldanerp.ordenes_compra;
--
-- CÓMO REVERTIR
--   Las columnas se pueden sacar sin perder nada de lo anterior:
--     ALTER TABLE roldanerp.ordenes_compra
--       DROP COLUMN IF EXISTS recibida_por_1,
--       DROP COLUMN IF EXISTS recibida_por_1_nombre,
--       DROP COLUMN IF EXISTS recibida_por_1_at,
--       DROP COLUMN IF EXISTS recibida_por_2,
--       DROP COLUMN IF EXISTS recibida_por_2_nombre,
--       DROP COLUMN IF EXISTS recibida_por_2_at;
--   (Eso borra el registro de quién confirmó qué, pero no las órdenes.)
--
-- CÓMO VERIFICAR  (no escribe nada)
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'roldanerp'
--      AND table_name   = 'ordenes_compra'
--      AND column_name LIKE 'recibida_%'
--    ORDER BY column_name;
--   -- Esperado: recibida_at, recibida_por_1, recibida_por_1_at,
--   --           recibida_por_1_nombre, recibida_por_2, recibida_por_2_at,
--   --           recibida_por_2_nombre
--
--   -- Y que no se haya movido nada:
--   SELECT estado, count(*) FROM roldanerp.ordenes_compra GROUP BY estado;
--
-- Solo escribe en `roldanerp`. Idempotente. No borra ni cambia datos.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.ordenes_compra') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.ordenes_compra. ¿Corriste los scripts anteriores?';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.ordenes_compra
  ADD COLUMN IF NOT EXISTS recibida_por_1        uuid        NULL,
  ADD COLUMN IF NOT EXISTS recibida_por_1_nombre text        NULL,
  ADD COLUMN IF NOT EXISTS recibida_por_1_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS recibida_por_2        uuid        NULL,
  ADD COLUMN IF NOT EXISTS recibida_por_2_nombre text        NULL,
  ADD COLUMN IF NOT EXISTS recibida_por_2_at     timestamptz NULL;

COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_1 IS
  'Primera confirmación de recepción: quién marcó «Recibido». NULL = en tránsito.';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_1_nombre IS
  'Nombre de quien hizo la primera confirmación (copia, para que no dependa del usuario).';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_1_at IS
  'Cuándo se hizo la primera confirmación.';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_2 IS
  'Segunda confirmación: el administrador que le dio «Aceptar». Tiene que ser otra persona. Con esta la orden queda recibida.';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_2_nombre IS
  'Nombre de quien aceptó (copia).';
COMMENT ON COLUMN roldanerp.ordenes_compra.recibida_por_2_at IS
  'Cuándo se aceptó. Mismo momento que recibida_at.';

-- Para el aviso de la campana: las que esperan la segunda confirmación.
CREATE INDEX IF NOT EXISTS ordenes_compra_recepcion_pendiente_idx
  ON roldanerp.ordenes_compra (empresa_id, recibida_por_1_at)
  WHERE recibida_por_1_at IS NOT NULL AND recibida_por_2_at IS NULL;

COMMIT;
