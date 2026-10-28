-- ===========================================================================
-- 40 · Teléfono real de un contacto de WhatsApp
-- ---------------------------------------------------------------------------
-- Desde 2024 WhatsApp identifica con un @lid (un código interno de 14 o 15
-- dígitos) a los clientes que no están agendados en el celular vinculado. El
-- inbox termina mostrando "22669458174192" como nombre y como número, que no
-- le sirve a nadie: no se puede reconocer al cliente ni llamarlo.
--
-- El teléfono de verdad SÍ llega: el puente lo resuelve y lo manda aparte. Lo
-- que faltaba era dónde guardarlo.
--
-- Se guarda en una columna NUEVA y no se pisa `phone_number`. Eso es a
-- propósito: `phone_number` es la clave con la que se encuentra la
-- conversación, y renombrarlo parte el chat en dos —el historial viejo queda
-- bajo el código y los mensajes nuevos abren otra conversación—. La columna
-- nueva es solo para mostrar y para que el vendedor pueda copiar el número.
--
-- Idempotente: se puede correr dos veces.
-- ===========================================================================

BEGIN;

SET LOCAL search_path = roldanerp, public;

DO $guard$
BEGIN
  IF to_regclass('roldanerp.chat_contacts') IS NULL THEN
    RAISE EXCEPTION 'No existe roldanerp.chat_contacts.';
  END IF;
END
$guard$;

ALTER TABLE roldanerp.chat_contacts
  ADD COLUMN IF NOT EXISTS telefono_real text NULL;

COMMENT ON COLUMN roldanerp.chat_contacts.telefono_real IS
  'Teléfono real del contacto cuando phone_number es un @lid de WhatsApp. '
  'Solo para mostrar y copiar: la conversación se sigue encontrando por '
  'phone_number, que no se toca para no partir el chat en dos.';

-- Para buscar un cliente por su número aunque el chat haya entrado con @lid.
CREATE INDEX IF NOT EXISTS chat_contacts_telefono_real_idx
  ON roldanerp.chat_contacts (empresa_id, telefono_real)
  WHERE telefono_real IS NOT NULL;

COMMIT;

DO $check$
DECLARE v_lid int; v_total int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='roldanerp' AND table_name='chat_contacts'
       AND column_name='telefono_real'
  ) THEN
    RAISE EXCEPTION 'Falta la columna chat_contacts.telefono_real';
  END IF;

  SELECT count(*) INTO v_total FROM roldanerp.chat_contacts;
  SELECT count(*) INTO v_lid FROM roldanerp.chat_contacts
   WHERE length(regexp_replace(coalesce(phone_number,''), '\D', '', 'g')) > 13;

  RAISE NOTICE 'Script 40 listo. % contactos, % con @lid. Los que ya están se completan solos cuando el cliente vuelva a escribir.', v_total, v_lid;
END
$check$;

NOTIFY pgrst, 'reload schema';
