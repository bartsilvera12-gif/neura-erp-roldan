-- Agrega 'cheque' como método de pago favorito válido del cliente.
-- Amplía el CHECK de `clientes.metodo_pago_preferido`. DDL idempotente (roldanerp).

DO $$
DECLARE r RECORD; cname text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes' AND c.relkind = 'r' AND n.nspname = 'roldanerp'
  LOOP
    FOR cname IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = format('%I.clientes', r.sch)::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%metodo_pago_preferido%'
    LOOP
      EXECUTE format('ALTER TABLE %I.clientes DROP CONSTRAINT %I', r.sch, cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.clientes ADD CONSTRAINT clientes_metodo_pago_preferido_check
         CHECK (metodo_pago_preferido IS NULL OR metodo_pago_preferido IN (''efectivo'', ''transferencia'', ''tarjeta'', ''cheque''))',
      r.sch
    );
  END LOOP;
END $$;
