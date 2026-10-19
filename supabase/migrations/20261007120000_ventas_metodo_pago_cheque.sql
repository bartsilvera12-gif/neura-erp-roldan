-- Agrega 'cheque' como método de pago válido en ventas.
-- Amplía el CHECK de `ventas.metodo_pago` y el de `ventas_pagos_detalle.metodo_pago`.
-- DDL idempotente sobre el schema del tenant `roldanerp`. No toca datos.

DO $$
DECLARE
  r RECORD;
  cname text;
BEGIN
  -- ventas.metodo_pago -> sumar 'cheque'
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas' AND c.relkind = 'r' AND n.nspname = 'roldanerp'
  LOOP
    FOR cname IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = format('%I.ventas', r.sch)::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%metodo_pago%'
    LOOP
      EXECUTE format('ALTER TABLE %I.ventas DROP CONSTRAINT %I', r.sch, cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.ventas ADD CONSTRAINT ventas_metodo_pago_chk
         CHECK (metodo_pago IS NULL OR metodo_pago IN (''efectivo'', ''tarjeta'', ''transferencia'', ''cheque''))',
      r.sch
    );
  END LOOP;

  -- ventas_pagos_detalle.metodo_pago -> sumar 'cheque'
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas_pagos_detalle' AND c.relkind = 'r' AND n.nspname = 'roldanerp'
  LOOP
    FOR cname IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = format('%I.ventas_pagos_detalle', r.sch)::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%metodo_pago%'
    LOOP
      EXECUTE format('ALTER TABLE %I.ventas_pagos_detalle DROP CONSTRAINT %I', r.sch, cname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I.ventas_pagos_detalle ADD CONSTRAINT ventas_pagos_detalle_metodo_pago_check
         CHECK (metodo_pago IN (''efectivo'', ''transferencia'', ''tarjeta'', ''qr'', ''billetera'', ''otro'', ''cheque''))',
      r.sch
    );
  END LOOP;
END $$;
