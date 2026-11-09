-- ============================================================================
-- Neura ERP · Aceros Metal Roldán e Hijos
-- 80 · Lo que le falta a la base para la app del asesor (la APK)
-- ============================================================================
--
-- ── QUÉ ES LA APP ──────────────────────────────────────────────────────────
--   Una ventana al ERP: abre `/m/asesor` en el teléfono, con la lista de
--   conversaciones asignadas y el chat. El código ya está; estas tres tablas
--   son lo que la base todavía no tenía.
--
-- ── LAS TRES ───────────────────────────────────────────────────────────────
--   1) agent_device_tokens            — el teléfono de cada asesor, para poder
--                                       avisarle. Vacía mientras no haya
--                                       Firebase: se llena sola cuando la app
--                                       registre el token.
--   2) usuario_horario_notificaciones — en qué horario quiere que le lleguen
--                                       los avisos. Sin fila, le llegan
--                                       siempre: es lo que espera alguien que
--                                       recién instala la app.
--   3) chat_conversation_attribution  — de qué anuncio de Facebook o Instagram
--                                       salió la conversación. El chat lo
--                                       muestra como una franja arriba, para
--                                       que el asesor sepa qué vio el cliente
--                                       antes de escribir.
--
-- Nada de esto toca lo que ya funciona: son tablas nuevas. Si no se corre, el
-- ERP sigue igual y la app abre y chatea; lo que no anda es el aviso al
-- teléfono y la franja del anuncio.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regclass('roldanerp.chat_conversations') IS NULL THEN
    RAISE EXCEPTION 'Falta roldanerp.chat_conversations: esta base no tiene el módulo de conversaciones.';
  END IF;
END
$guard$;

-- ── 1) El teléfono de cada asesor ──────────────────────────────────────────
--
-- Una fila por aparato, no por persona: la misma asesora puede tener la app en
-- su celular y en el de la empresa, y el aviso tiene que llegar a los dos.
CREATE TABLE IF NOT EXISTS roldanerp.agent_device_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  -- Su fila en `chat_agents`, si es agente de alguna cola. Puede ser NULL:
  -- alguien registra el aparato antes de que lo pongan en una cola.
  agent_id          uuid NULL,
  user_id           uuid NOT NULL,
  platform          text NOT NULL DEFAULT 'android'
                     CHECK (platform IN ('android','ios','web')),
  fcm_token         text NOT NULL,
  device_name       text NULL,
  app_version       text NULL,
  -- Se apaga en vez de borrarse: así queda el rastro de qué aparato tenía.
  is_active         boolean NOT NULL DEFAULT true,
  last_seen_at      timestamptz NULL,
  last_push_ack_at  timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.agent_device_tokens IS
  'Los teléfonos con la app del asesor instalada, para poder mandarles el '
  'aviso de un mensaje nuevo. Una fila por aparato: la misma persona puede '
  'tener la app en dos.';

-- El token identifica el aparato: si el mismo vuelve a registrarse, se
-- actualiza la fila en vez de duplicarla. La app lo manda en cada arranque.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adt_empresa_token
  ON roldanerp.agent_device_tokens (empresa_id, fcm_token);

CREATE INDEX IF NOT EXISTS idx_adt_user_active
  ON roldanerp.agent_device_tokens (empresa_id, user_id, is_active);

-- ── 2) En qué horario quiere que le avisen ─────────────────────────────────
--
-- Sin fila, le llega siempre. Es a propósito: alguien que recién instaló la
-- app espera que le avise, no que calle hasta configurar algo.
CREATE TABLE IF NOT EXISTS roldanerp.usuario_horario_notificaciones (
  usuario_id  uuid PRIMARY KEY,
  empresa_id  uuid NOT NULL,
  -- Apagado general: "no me avises nada".
  notificar   boolean NOT NULL DEFAULT true,
  -- El horario está activo. En false, `franjas` se ignora y avisa siempre.
  activo      boolean NOT NULL DEFAULT false,
  -- Las franjas por día, como las guarda la pantalla.
  franjas     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.usuario_horario_notificaciones IS
  'Horario en que cada persona quiere recibir los avisos de la app. Sin fila, '
  'le llegan siempre.';

-- ── 3) De qué anuncio salió la conversación ────────────────────────────────
--
-- Cuando alguien escribe desde un anuncio de Facebook o Instagram, Meta manda
-- de qué anuncio vino. Se guarda acá, una sola vez, la primera vez: por eso
-- `conversation_id` es único y hay un `first_message_at`. Lo que el cliente
-- vio antes de escribir no cambia después.
CREATE TABLE IF NOT EXISTS roldanerp.chat_conversation_attribution (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  conversation_id           uuid NOT NULL UNIQUE,
  contact_id                uuid NULL,
  channel_id                uuid NULL,
  provider                  text NOT NULL DEFAULT 'meta'
                            CHECK (provider IN ('meta','ycloud')),

  -- Lo que entrega Meta en el referral del Click-to-WhatsApp.
  meta_ad_id                text NULL,
  meta_source_type          text NULL,
  meta_source_url           text NULL,
  meta_ctwa_clid            text NULL,
  meta_headline             text NULL,
  meta_body                 text NULL,
  meta_media_type           text NULL,
  meta_image_url            text NULL,
  meta_video_url            text NULL,
  meta_thumbnail_url        text NULL,

  -- Se completan después, si algún día se consulta la API de Meta.
  meta_campaign_id          text NULL,
  meta_campaign_name        text NULL,
  meta_adset_id             text NULL,
  meta_adset_name           text NULL,
  meta_ad_name              text NULL,

  utm_source                text NULL,
  utm_medium                text NULL,
  utm_campaign              text NULL,
  utm_content               text NULL,
  utm_term                  text NULL,

  -- Un recorte del referral original, no el evento entero.
  first_attribution_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_message_at          timestamptz NOT NULL DEFAULT now(),
  source_message_id         uuid NULL,
  captured_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roldanerp.chat_conversation_attribution IS
  'De qué anuncio de Facebook o Instagram salió la conversación. Se guarda la '
  'primera vez y no se pisa: lo que el cliente vio antes de escribir no '
  'cambia después.';

CREATE INDEX IF NOT EXISTS idx_cca_empresa_first_msg
  ON roldanerp.chat_conversation_attribution (empresa_id, first_message_at);

CREATE INDEX IF NOT EXISTS idx_cca_meta_ad
  ON roldanerp.chat_conversation_attribution (empresa_id, meta_ad_id)
  WHERE meta_ad_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cca_contact
  ON roldanerp.chat_conversation_attribution (empresa_id, contact_id)
  WHERE contact_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Resumen ────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM roldanerp.agent_device_tokens)              AS telefonos_registrados,
  (SELECT count(*) FROM roldanerp.agent_device_tokens
    WHERE is_active)                                                AS telefonos_activos,
  (SELECT count(*) FROM roldanerp.usuario_horario_notificaciones)   AS horarios_cargados,
  (SELECT count(*) FROM roldanerp.chat_conversation_attribution)    AS conversaciones_con_anuncio;
