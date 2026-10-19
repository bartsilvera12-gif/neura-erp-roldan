-- Emisor del presupuesto: usuario que lo creó (para mostrar "Emitido por" con
-- su nombre/teléfono/email en el PDF). DDL idempotente sobre el schema roldanerp.
--   usuario_id     -> auth_user_id del usuario (se une a usuarios.auth_user_id).
--   usuario_nombre -> snapshot (email o nombre) por si el usuario cambia/borra.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'presupuestos' AND c.relkind = 'r' AND n.nspname = 'roldanerp'
  LOOP
    EXECUTE format('ALTER TABLE %I.presupuestos ADD COLUMN IF NOT EXISTS usuario_id uuid', r.sch);
    EXECUTE format('ALTER TABLE %I.presupuestos ADD COLUMN IF NOT EXISTS usuario_nombre text', r.sch);
  END LOOP;
END $$;
