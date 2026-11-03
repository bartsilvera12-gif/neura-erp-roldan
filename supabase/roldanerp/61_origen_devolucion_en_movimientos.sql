-- ============================================================================
-- Neura ERP · Roldán e Hijos
-- 61 · El movimiento de inventario de una devolución
-- ============================================================================
--
-- ── EL ERROR ───────────────────────────────────────────────────────────────
--   Al cerrar una devolución de la venta VTA-000020:
--
--     new row for relation "movimientos_inventario" violates check constraint
--     "movimientos_inventario_origen_check"
--
--   La devolución devuelve la mercadería al depósito y deja el movimiento con
--   `origen = 'devolucion_venta'`. El código lo viene escribiendo así desde
--   que existe el módulo —está en `OrigenMovimiento`, en
--   src/lib/inventario/types.ts— pero la restricción de la base nunca lo
--   incluyó: el esquema vino clonado de otra empresa, que no tenía
--   devoluciones. O sea que NINGUNA devolución se pudo cerrar nunca, y el
--   error aparece recién al confirmar, con el cliente esperando.
--
--   Los otros orígenes del módulo están en la misma situación:
--   'devolucion_proveedor', 'transferencia_salida' y 'transferencia_entrada'
--   tampoco figuran entre los que la base tiene cargados hoy
--   (venta, compra, ajuste_manual, inventario_inicial, anulacion_compra,
--   anulacion_venta, edicion_venta, edicion_venta_reversa). Se agregan los
--   cuatro de una vez: que el primer flete entre sucursales se entere de esto
--   el día que se haga sería el mismo problema otra vez.
--
-- ── POR QUÉ SE EXTIENDE Y NO SE REESCRIBE LA LISTA ─────────────────────────
--   La restricción se lee de la base y se le agrega `OR origen IN (...)`, en
--   vez de escribir a mano la lista completa. Escribirla a mano significa
--   adivinar qué valores acepta hoy: el que falte deja de poder registrarse y
--   el error aparece en otro lado, en una compra o una anulación, días
--   después y sin relación visible con este script.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.movimientos_inventario') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.movimientos_inventario. Correr antes el script 01.';
  END IF;
END
$guard$;

DO $origen$
DECLARE
  c RECORD;
  expr text;
  nuevos text[] := ARRAY[
    'devolucion_venta',
    'devolucion_proveedor',
    'transferencia_salida',
    'transferencia_entrada'
  ];
  faltan text[];
  v text;
  encontrada boolean := false;
BEGIN
  FOR c IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.conrelid = 'roldanerp.movimientos_inventario'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%origen%'
  LOOP
    encontrada := true;

    -- Solo los que esta restricción todavía no acepta.
    --
    -- Se busca el valor como texto suelto y no entre comillas, porque después
    -- de la primera corrida la lista agregada queda escrita como un arreglo
    -- ('{a,b,c}') y los valores ya no van comillados uno por uno. Con la
    -- búsqueda entre comillas, cada corrida volvería a agregar el mismo OR y
    -- la restricción crecería para siempre.
    faltan := ARRAY[]::text[];
    FOREACH v IN ARRAY nuevos LOOP
      IF position(v IN c.def) = 0 THEN
        faltan := faltan || v;
      END IF;
    END LOOP;

    IF cardinality(faltan) = 0 THEN
      RAISE NOTICE 'La restricción % ya los acepta a todos. Nada que hacer.', c.conname;
      CONTINUE;
    END IF;

    -- `pg_get_constraintdef` devuelve 'CHECK (<expr>)'. Se saca el envoltorio
    -- y se vuelve a armar con el OR agregado.
    expr := regexp_replace(c.def, '^CHECK\s*\((.*)\)\s*$', '\1');
    IF expr = c.def THEN
      RAISE EXCEPTION 'No se pudo leer la restricción %: %', c.conname, c.def;
    END IF;

    EXECUTE format('ALTER TABLE roldanerp.movimientos_inventario DROP CONSTRAINT %I', c.conname);
    EXECUTE format(
      'ALTER TABLE roldanerp.movimientos_inventario ADD CONSTRAINT %I CHECK ((%s) OR origen::text = ANY (%L::text[]))',
      c.conname, expr, nuevos
    );
    RAISE NOTICE 'Restricción % extendida con: %', c.conname, array_to_string(faltan, ', ');
  END LOOP;

  IF NOT encontrada THEN
    RAISE NOTICE 'La tabla no tiene restricción sobre origen: no hay nada que extender.';
  END IF;
END
$origen$;

-- ── Verificación ───────────────────────────────────────────────────────────
-- Tiene que listar los cuatro orígenes nuevos adentro de la definición.
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'roldanerp.movimientos_inventario'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%origen%';
