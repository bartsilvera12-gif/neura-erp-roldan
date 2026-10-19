-- Emitente del ticket: usuario/cajero que registró la venta.
-- Agrega columnas de auditoría a `ventas` para poder imprimir en el ticket
-- quién hizo la venta (además de la sucursal, que ya se guarda en `sucursal_id`).
-- Aplica en el schema del tenant `roldanerp`. No toca datos: solo DDL idempotente.
--
--   · usuario_id     -> PK del usuario en el catálogo del tenant (createdBy).
--   · usuario_nombre -> etiqueta legible para el ticket (email o nombre).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas'
      AND c.relkind = 'r'
      AND n.nspname = 'roldanerp'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS usuario_id uuid',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS usuario_nombre text',
      r.sch
    );
  END LOOP;
END $$;
