/**
 * Webhook de entrada del canal WhatsApp QR (Baileys).
 *
 * Lo llama el "puente" (servicio Baileys aislado, ej. contenedor Coolify) cuando
 * llega un mensaje al número vinculado. Reusa la maquinaria omnicanal existente:
 *   - `saveIncomingMessage`  → contacto + conversación + mensaje (schema del tenant,
 *      vía shim PG para schemas no expuestos como `neura`).
 *   - Contact Center V1       → ventana 24h + asignación por equidad (misma RPC que YCloud).
 *
 * Seguridad: header `x-bridge-secret` debe coincidir con `BAILEYS_BRIDGE_SECRET`.
 *
 * Cuerpo esperado (JSON):
 *   { channelId, empresaId, fromDigits, waMessageId, messageKind,
 *     text?, pushName?, hasMedia?, timestamp? }
 *
 * Para media (foto/video/audio/doc/sticker): el bridge llama a /inbound con
 * este JSON (el mensaje queda con placeholder "[imagen]" / "[video]" / ...),
 * y después sube el archivo por multipart a /inbound/media con el mismo
 * waMessageId. Ese segundo endpoint es el que attachéa la URL del archivo
 * a la fila ya persistida acá.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  saveIncomingMessage,
  isChatChannelType,
  type ChatChannelType,
} from "@/lib/chat/incoming-message-service";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

const LOG = "[webhooks/baileys/inbound]";

type MappedKind =
  | { skip: true; reason: string }
  | { skip?: false; message_type: string; placeholder: string };

/**
 * Mapea el tipo de mensaje de Baileys al `message_type` del ERP + un preview.
 *
 * Antes el `default` guardaba todo como `text` con contenido vacío, y en el inbox
 * aparecían burbujas grises sin texto cada vez que el cliente reaccionaba con un
 * emoji, editaba un mensaje o eliminaba uno (y también para eventos de protocolo
 * internos que WhatsApp manda y no son conversación). Ahora:
 *  - Los tipos útiles con texto/media siguen mapeando igual.
 *  - Las reacciones/ediciones/revokes se marcan con su `message_type` propio;
 *    si el bridge adjunta un placeholder, se muestra algo visible (si no, el
 *    front los filtra por `message_type !== 'reaction'` para no estorbar).
 *  - Los tipos de protocolo o desconocidos se SALTEAN (no se crea fila). El
 *    webhook responde 200 OK y punto; sin esto el inbox se ensucia.
 */
function mapKind(kind: string): MappedKind {
  switch (kind) {
    // Los puentes no hablan todos el mismo idioma. Los más nuevos mandan el
    // nombre crudo de Baileys (`imageMessage`); los que están andando desde
    // antes mandan el tipo ya resumido (`image`). Se aceptan los dos: si el
    // ERP entendiera solo uno, con el otro puente NO ENTRA NINGÚN MENSAJE
    // —caen todos al default y se saltean— y el único rastro es una línea de
    // log que nadie mira.
    case "text":
    case "conversation":
    case "extendedTextMessage":
      return { message_type: "text", placeholder: "" };
    case "image":
    case "imageMessage":
      return { message_type: "image", placeholder: "[imagen]" };
    case "video":
    case "videoMessage":
      return { message_type: "video", placeholder: "[video]" };
    case "audio":
    case "audioMessage":
      return { message_type: "audio", placeholder: "[audio]" };
    case "document":
    case "documentMessage":
    case "documentWithCaptionMessage":
      return { message_type: "document", placeholder: "[documento]" };
    case "sticker":
    case "stickerMessage":
      return { message_type: "sticker", placeholder: "[sticker]" };
    case "location":
    case "locationMessage":
    case "liveLocationMessage":
      return { message_type: "location", placeholder: "[ubicación]" };
    case "contact":
    case "contactMessage":
    case "contactsArrayMessage":
      return { message_type: "contacts", placeholder: "[contacto]" };
    case "reactionMessage":
      return { message_type: "reaction", placeholder: "" };
    case "editedMessage":
    case "messageEditMessage":
      return { message_type: "edit", placeholder: "[mensaje editado]" };
    // protocolMessage incluye revokes, syncs, keys, acks de protocolo: nada
    // de esto es conversación. Antes caían al default y aparecían como
    // burbujas vacías. Se saltean a propósito.
    case "unknown":
    case "protocolMessage":
    case "senderKeyDistributionMessage":
    case "messageContextInfo":
    case "ephemeralMessage":
    case "pollUpdateMessage":
      return { skip: true, reason: kind };
    default:
      // Cualquier tipo nuevo que no reconocemos NO lo guardamos como texto
      // vacío. Si en el futuro aparece algo útil (polls, buttons), se agrega
      // acá explícitamente. Mientras tanto queda el log y la fila no se crea.
      return { skip: true, reason: `desconocido:${kind}` };
  }
}

export async function POST(request: NextRequest) {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) {
    console.error(LOG, "BAILEYS_BRIDGE_SECRET no configurado en el servidor");
    return NextResponse.json({ ok: false, error: "bridge_secret_not_configured" }, { status: 500 });
  }
  const provided = (request.headers.get("x-bridge-secret") || "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 });
  }

  const channelId = String(body?.channelId ?? "").trim();
  const empresaId = String(body?.empresaId ?? "").trim();
  const fromDigits = normalizeWaPhone(String(body?.fromDigits ?? ""));
  // Teléfono de verdad cuando el chat entra con un @lid (el código interno de
  // WhatsApp para los contactos que no están agendados en el celular).
  const fromPhone = normalizeWaPhone(String(body?.fromPhone ?? ""));
  // A qué mensaje responde éste. Sin esto, una respuesta del cliente —incluso un "."— llegaba
  // al inbox como una burbuja suelta y nadie sabía a qué contestaba.
  const quotedWaMessageId = String(body?.quotedWaMessageId ?? "").trim();
  // Tarjeta(s) de contacto compartidas, ya con la forma que el inbox sabe dibujar.
  const contacts = Array.isArray(body?.contacts) ? body!.contacts : null;
  // JID original de WhatsApp con su sufijo real (`<id>@lid` o `<pn>@s.whatsapp.net`).
  // El puente ya lo manda; lo preservamos para enviar al destino correcto (ver abajo).
  const fromJid = typeof body?.fromJid === "string" ? (body.fromJid as string).trim() : "";
  const waMessageId = String(body?.waMessageId ?? "").trim();
  const messageKind = String(body?.messageKind ?? "conversation");
  const text = typeof body?.text === "string" ? body.text : "";
  const pushName = typeof body?.pushName === "string" ? (body.pushName as string) : null;
  // true = saliente espejado del celu (la PM respondió desde la app); false = entrante del cliente.
  const fromMe = body?.fromMe === true;
  if (!channelId || !empresaId || !fromDigits || !waMessageId) {
    return NextResponse.json(
      { ok: false, error: "faltan campos: channelId, empresaId, fromDigits, waMessageId" },
      { status: 400 }
    );
  }

  try {
    const supabase = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

    // Validar que el canal exista, sea de esta empresa y esté activo.
    const { data: channelRow, error: chErr } = await supabase
      .from("chat_channels")
      .select("id, empresa_id, type, provider, activo")
      .eq("id", channelId)
      .maybeSingle();
    if (chErr) throw new Error(chErr.message);
    if (!channelRow) {
      return NextResponse.json({ ok: false, error: "canal_no_encontrado" }, { status: 404 });
    }
    const ch = channelRow as {
      empresa_id?: string;
      type?: string | null;
      provider?: string | null;
      activo?: boolean | null;
    };
    if (String(ch.empresa_id ?? "") !== empresaId) {
      return NextResponse.json({ ok: false, error: "empresa_mismatch" }, { status: 400 });
    }
    if (ch.activo === false) {
      return NextResponse.json({ ok: false, error: "canal_inactivo" }, { status: 409 });
    }

    const rawType = String(ch.type ?? "whatsapp");
    const channelType: ChatChannelType = isChatChannelType(rawType) ? rawType : "whatsapp";

    const mapped = mapKind(messageKind);
    if (mapped.skip) {
      // Tipo irrelevante para el inbox (protocolo, update de poll, etc). Ack OK
      // sin crear fila; el bridge no reintenta y el inbox queda limpio.
      console.info(LOG, "skip_kind", { kind: messageKind, reason: mapped.reason });
      return NextResponse.json({ ok: true, skipped: true, reason: mapped.reason });
    }
    const { message_type, placeholder } = mapped;
    const content = message_type === "text" ? text : text || placeholder;

    // El contacto se guarda SIEMPRE con el identificador con el que llega el mensaje.
    //
    // Se probó guardarlo con el teléfono real cuando WhatsApp lo mandaba, para que el inbox no
    // mostrara el código interno. Resultado: se duplicaron los chats. El contacto viejo seguía
    // existiendo bajo el código y el mensaje nuevo creaba otro bajo el teléfono, así que el
    // mismo cliente aparecía dos veces, en dos colas y con dos agentes.
    //
    // Mostrar el código feo es mucho menos grave que duplicar conversaciones. Para arreglar lo
    // que se ve sin partir nada hay que guardar el @lid EN el contacto y buscar por los dos.
    const direccionContacto = fromDigits;

    const result = await saveIncomingMessage({
      supabase,
      channel: { id: channelId, empresa_id: empresaId, type: channelType },
      external_id: waMessageId,
      // En los salientes espejados (fromMe) el pushName es el del negocio, no el del contacto:
      // no pisamos el nombre del contacto con eso.
      contact_data: { address: direccionContacto, display_name: fromMe ? null : pushName },
      message_data: {
        message_type,
        content: content || placeholder || "",
        raw_payload: {
          source: "baileys",
          // `contacts` en la raíz es donde el inbox busca las tarjetas de contacto (misma
          // forma que YCloud/Meta), así que se guardan ahí y se dibujan sin tocar el front.
          ...(contacts ? { contacts } : {}),
          bridge: {
            fromDigits,
            messageKind,
            hasMedia: Boolean(body?.hasMedia),
            fromMe,
            timestamp: body?.timestamp ?? null,
            quoted_wamid: quotedWaMessageId || null,
          },
        },
        from_me: fromMe,
        sender_type: fromMe ? "human" : "contact",
      },
    });

    if (!result.ok) {
      console.warn(LOG, "saveIncomingMessage_error", result.error);
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    if (result.skipped_duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const conversationId = result.conversation_id;

    // El teléfono real va en una columna aparte, solo para mostrar. NO se
    // renombra phone_number: esa es la clave con la que se encuentra la
    // conversación, y cambiarla parte el chat en dos (el historial queda bajo
    // el código y los mensajes nuevos abren otra conversación).
    if (fromPhone && fromPhone !== fromDigits) {
      const up = await supabase
        .from("chat_contacts")
        .update({ telefono_real: fromPhone })
        .eq("empresa_id", empresaId)
        .eq("phone_number", direccionContacto);
      // Sin el script 40 la columna no existe: se anota y se sigue, que el
      // mensaje ya quedó guardado y es lo que importa.
      if (up.error) console.warn(LOG, "telefono_real", up.error.message);
    }

    // El sistema propio guarda acá el JID original y fusiona los chats que
    // entran con un @lid (el identificador interno de WhatsApp) con el
    // contacto del teléfono real. Eso depende de tres columnas y una función
    // de base que este esquema no tiene, así que no se copió: un chat que
    // entre con @lid va a mostrar ese código en vez del número, que es feo
    // pero no parte nada. Si llega a pasar seguido, se trae junto con su
    // script de base.

    // Nota: los bytes de la media (foto/video/audio/doc/sticker) los sube el
    // bridge como multipart al endpoint /inbound/media, usando el mismo
    // waMessageId. Ese otro route es el que adjunta la URL del archivo a la
    // fila que acabamos de persistir acá. No bloqueamos este ack esperando
    // la descarga de bytes.

    console.info(LOG, "ok", {
      channelId,
      conversationId,
      message_type,
      jid_tipo: fromJid.endsWith("@lid") ? "lid" : fromJid.endsWith("@s.whatsapp.net") ? "pn" : fromJid ? "otro" : "sin_jid",
    });
    return NextResponse.json({
      ok: true,
      conversation_id: conversationId,
      message_id: result.message_id,
    });
  } catch (err) {
    console.error(LOG, "error", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
