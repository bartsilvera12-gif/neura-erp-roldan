-- Campo opcional "Nombre comercial / Sucursal / Local" en clientes.
-- Separado de la razón social (empresa) y del nombre de facturación: sirve para
-- identificar el local/sucursal en entregas y documentos logísticos SIN alterar
-- el nombre que se usa para facturar. DDL idempotente sobre el schema roldanerp.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes' AND c.relkind = 'r' AND n.nspname = 'roldanerp'
  LOOP
    EXECUTE format('ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS nombre_comercial text', r.sch);
  END LOOP;
END $$;
