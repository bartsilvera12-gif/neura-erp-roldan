-- ===========================================================================
-- 47 · Catálogo de profesiones
-- ---------------------------------------------------------------------------
-- La profesión del cliente se escribía a mano en cada ficha. Con texto libre
-- terminan conviviendo "ALBAÑIL", "Albanil" y "albañil " como si fueran tres
-- cosas distintas, y después no se puede filtrar ni contar nada por rubro de
-- oficio — que es justo para lo que sirve el dato en una ferretería.
--
-- Pasa a ser un catálogo, igual que los rubros de cliente: se carga una vez y
-- se elige de una lista.
--
-- Se agrega además la profesión al presupuesto, al lado de los otros datos
-- del cliente, como copia y no como referencia: si la ficha cambia después,
-- el documento emitido no cambia.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

CREATE TABLE IF NOT EXISTS roldanerp.profesiones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  nombre     text NOT NULL,
  orden      integer NOT NULL DEFAULT 0,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.profesiones IS
  'Profesiones u oficios del cliente. Catálogo para no tener el mismo oficio '
  'escrito de cinco formas distintas.';

-- Una sola vez cada nombre por empresa. Sin esto, dos personas cargando a la
-- vez dejan la lista con duplicados y el selector muestra dos iguales.
CREATE UNIQUE INDEX IF NOT EXISTS profesiones_empresa_nombre_uniq
  ON roldanerp.profesiones (empresa_id, upper(btrim(nombre)));

-- Las profesiones que ya estaban escritas a mano en las fichas: se rescatan
-- para no perder lo cargado ni dejar fichas apuntando a algo que no existe.
INSERT INTO roldanerp.profesiones (empresa_id, nombre)
SELECT DISTINCT c.empresa_id, upper(btrim(c.profesion))
  FROM roldanerp.clientes c
 WHERE c.profesion IS NOT NULL
   AND btrim(c.profesion) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM roldanerp.profesiones p
      WHERE p.empresa_id = c.empresa_id
        AND upper(btrim(p.nombre)) = upper(btrim(c.profesion))
   );

ALTER TABLE roldanerp.presupuestos
  ADD COLUMN IF NOT EXISTS cliente_profesion text NULL;

COMMENT ON COLUMN roldanerp.presupuestos.cliente_profesion IS
  'Profesión del cliente al momento de emitir el presupuesto. Copia, no '
  'referencia: si la ficha cambia después, el documento emitido no cambia.';

COMMIT;

DO $check$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='presupuestos'
       AND column_name='cliente_profesion'
  ) THEN
    RAISE EXCEPTION 'Falta la columna presupuestos.cliente_profesion';
  END IF;

  SELECT count(*) INTO v_n FROM roldanerp.profesiones;
  RAISE NOTICE 'Script 47 listo: tabla profesiones con % fila(s). Se cargan en Configuración → Profesiones.', v_n;
END
$check$;

NOTIFY pgrst, 'reload schema';
