-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 81 · La cola de avisos al teléfono del asesor
-- ============================================================================
--
-- ── POR QUÉ UNA COLA Y NO MANDAR EL AVISO DE UNA ───────────────────────────
--   Porque mandar el push es hablar con Google, y eso puede tardar o fallar.
--   Si el webhook de WhatsApp tuviera que esperar a FCM para contestar,
--   WhatsApp lo daría por caído y reintentaría el mensaje: el cliente quedaría
--   duplicado en el chat por un problema que no tiene nada que ver con él.
--
--   Entonces: cuando entra un mensaje se escribe una fila acá y se contesta.
--   El que manda los avisos la lee después, en su propio tiempo.
--
-- ── Y PORQUE DESPUÉS HAY QUE PODER MIRAR QUÉ PASÓ ──────────────────────────
--   "A mí no me llegó nada" es la frase con la que empiezan estos problemas.
--   Sin registro no hay forma de saber si el aviso no se generó, no se mandó,
--   lo rechazó Google o el teléfono lo recibió y la persona no lo vio. Cada
--   fila guarda en qué quedó:
--
--     pending  — está en la cola, todavía no salió.
--     sent     — Google lo aceptó. Queda el id que devolvió.
--     failed   — se intentó y falló. Queda el motivo.
--     skipped  — no correspondía mandarlo: el asesor no tiene la app, o estaba
--                fuera del horario que configuró. No es un error.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.chat_conversations') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.chat_conversations.';
  END IF;
  IF to_regclass('roldanerp.agent_device_tokens') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.agent_device_tokens: correr antes 80_app_del_asesor.sql.';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS roldanerp.agent_notification_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  -- A quién. Es su fila en `chat_agents`, no el usuario: el aviso es del que
  -- atiende la conversación.
  agent_id            uuid NULL,
  -- Si se borra la conversación, el aviso ya no tiene de qué hablar.
  conversation_id     uuid NULL REFERENCES roldanerp.chat_conversations(id) ON DELETE CASCADE,
  type                text NOT NULL
                       CHECK (type IN ('new_lead','new_message','reassigned','sla_warning')),
  -- Hoy siempre 'fcm'. Los otros están por si algún día se avisa por otro lado.
  channel             text NOT NULL DEFAULT 'fcm'
                       CHECK (channel IN ('fcm','email','sms','realtime')),
  status              text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','sent','failed','acknowledged','skipped')),
  -- Lo que devolvió Google al aceptarlo. Sirve para rastrear un aviso puntual.
  provider_message_id text NULL,
  -- Por qué falló, o por qué se salteó ('no_active_device', 'fuera_de_horario').
  error_message       text NULL,
  sent_at             timestamptz NULL,
  acknowledged_at     timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- El contenido del aviso: de qué mensaje salió y el pedacito que se muestra.
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE roldanerp.agent_notification_events IS
  'La cola de avisos al teléfono del asesor, y en qué quedó cada uno. Se '
  'escribe cuando entra un mensaje y la lee el emisor de push. Es también el '
  'único lugar donde mirar cuando alguien dice que no le llegó nada.';

COMMENT ON COLUMN roldanerp.agent_notification_events.status IS
  'pending (en la cola) · sent (Google lo aceptó) · failed (se intentó y '
  'falló) · skipped (no correspondía: sin app o fuera de horario) · '
  'acknowledged (lo tocaron en el teléfono).';

-- La consulta del emisor: "¿qué hay sin mandar?", en orden de llegada.
CREATE INDEX IF NOT EXISTS idx_ane_pending
  ON roldanerp.agent_notification_events (empresa_id, status, created_at);

-- Para mirar el historial de una conversación o de una persona.
CREATE INDEX IF NOT EXISTS idx_ane_agent_conv
  ON roldanerp.agent_notification_events (empresa_id, agent_id, conversation_id);

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  count(*)                                       AS avisos,
  count(*) FILTER (WHERE status = 'pending')     AS en_cola,
  count(*) FILTER (WHERE status = 'sent')        AS mandados,
  count(*) FILTER (WHERE status = 'failed')      AS fallaron,
  count(*) FILTER (WHERE status = 'skipped')     AS no_correspondia
FROM roldanerp.agent_notification_events;
