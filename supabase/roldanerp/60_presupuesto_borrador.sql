-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 60 · Presupuestos: el estado "borrador"
-- ============================================================================
--
-- ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
--   "Que siempre se guarde todos los presupuestos como borrador si es que
--    salen."
--
--   El presupuesto se imprime desde la ficha, o sea que primero hay que
--   guardarlo. Y desde que el alta de cliente pide RUC, teléfono, profesión y
--   ciudad, el que no tiene esos datos NO PUEDE GUARDAR: la cotización sale
--   igual —el cliente está en el mostrador esperando el precio— pero sale a
--   mano y no queda registrada en ninguna parte. Justo al revés de lo que se
--   quería: los datos obligatorios se pusieron para no tener fichas a medias
--   y el efecto fue perder cotizaciones enteras.
--
--   El "borrador" es la salida: se guarda con lo que haya, queda el registro
--   de qué se cotizó y a qué precio, y los datos del cliente se piden recién
--   cuando ese presupuesto se quiere mandar, aprobar o cobrar.
--
-- ── QUÉ HACE ESTE SCRIPT ───────────────────────────────────────────────────
--   Agrega 'borrador' a la restricción de estados de `presupuestos`, si esa
--   restricción existe. Se busca cualquier CHECK de la tabla que mencione los
--   estados y se la reescribe con la lista completa; si no hay ninguna, no hay
--   nada que hacer y el script lo dice.
--
--   NO cambia el estado de ningún presupuesto ya cargado. Los que están en
--   'creado' siguen en 'creado': un borrador es lo que nace incompleto de
--   ahora en adelante, y reetiquetar lo viejo sería inventar un dato.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.presupuestos') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.presupuestos. Correr antes el script 01.';
  END IF;
END
$guard$;

DO $borrador$
DECLARE
  c RECORD;
  tocadas int := 0;
BEGIN
  -- Cualquier CHECK de la tabla que nombre los estados del presupuesto. Se
  -- busca por contenido y no por nombre porque el esquema vino clonado de
  -- otra empresa y el nombre de la restricción no está garantizado.
  FOR c IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.conrelid = 'roldanerp.presupuestos'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
      AND pg_get_constraintdef(con.oid) ILIKE '%creado%'
  LOOP
    IF c.def ILIKE '%borrador%' THEN
      RAISE NOTICE 'La restricción % ya permite borrador. Nada que hacer.', c.conname;
      tocadas := tocadas + 1;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE roldanerp.presupuestos DROP CONSTRAINT %I', c.conname);
    EXECUTE format(
      'ALTER TABLE roldanerp.presupuestos ADD CONSTRAINT %I CHECK (estado IN (%L,%L,%L,%L,%L,%L))',
      c.conname, 'borrador', 'creado', 'enviado', 'aprobado', 'rechazado', 'convertido'
    );
    RAISE NOTICE 'Restricción % reescrita: ahora acepta borrador.', c.conname;
    tocadas := tocadas + 1;
  END LOOP;

  IF tocadas = 0 THEN
    RAISE NOTICE 'La tabla no tiene restricción de estados: borrador ya se puede guardar sin tocar nada.';
  END IF;
END
$borrador$;

-- Para encontrarlos rápido: los borradores son la bandeja de "cotizaciones a
-- completar", y se van a mirar juntos.
CREATE INDEX IF NOT EXISTS idx_presupuestos_borrador
  ON roldanerp.presupuestos (empresa_id, created_at DESC)
  WHERE estado = 'borrador';

COMMENT ON COLUMN roldanerp.presupuestos.estado IS
  'borrador = se guardó con datos del cliente incompletos, para no perder la cotización. '
  'creado → enviado → aprobado → convertido es el camino normal. '
  'Un borrador no se puede mandar, aprobar ni cobrar hasta que tenga RUC, teléfono, profesión y ciudad.';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT estado, count(*) AS cantidad
FROM roldanerp.presupuestos
GROUP BY estado
ORDER BY cantidad DESC;
