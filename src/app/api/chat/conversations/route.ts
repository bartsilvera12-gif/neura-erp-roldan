import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { ensureCentralChatChannelMirror } from "@/lib/chat/central-chat-channel-mirror";
import { ensureCentralChatContactMirror } from "@/lib/chat/central-chat-contact-mirror";
import { ensureCentralChatConversationMirror } from "@/lib/chat/central-chat-conversation-mirror";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

const LOG = "[chat-conversations-create]";

/** Teléfono válido: código de país + número, sin @lid ni JID de grupo. */
function isPlausiblePhone(digits: string): boolean {
  return digits.length >= 8 && digits.length <= 13;
}

/**
 * POST /api/chat/conversations
 * Abre (o recupera) la conversación de un número para un canal: lo usa el botón
 * "Nuevo chat" del inbox, cuando el operador escribe primero.
 *
 * Body: { phone, channel_id, name? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => null)) as
      | { phone?: unknown; channel_id?: unknown; name?: unknown }
      | null;
    const phoneRaw = typeof body?.phone === "string" ? body.phone : "";
    const channelId = typeof body?.channel_id === "string" ? body.channel_id.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";

    const phone = normalizeWaPhone(phoneRaw);
    if (!phone || !isPlausiblePhone(phone)) {
      return NextResponse.json(
        { ok: false, error: "Número inválido. Escribilo con código de país, por ejemplo 595981123456." },
        { status: 400 }
      );
    }
    if (!channelId) {
      return NextResponse.json({ ok: false, error: "Se requiere channel_id" }, { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(empresaId);

    const { data: channel, error: chErr } = await supabase
      .from("chat_channels")
      .select("id, empresa_id, type, activo")
      .eq("id", channelId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (chErr) {
      return NextResponse.json({ ok: false, error: `Canal: ${chErr.message}` }, { status: 500 });
    }
    if (!channel?.id) {
      return NextResponse.json({ ok: false, error: "Canal no encontrado" }, { status: 404 });
    }
    if (channel.activo === false) {
      return NextResponse.json({ ok: false, error: "El canal está inactivo" }, { status: 400 });
    }

    const { data: contact, error: cErr } = await supabase
      .from("chat_contacts")
      .upsert(
        {
          empresa_id: empresaId,
          phone_number: phone,
          phone_normalized: phone,
          ...(name ? { name } : {}),
        },
        { onConflict: "empresa_id,phone_number" }
      )
      .select("id, name")
      .single();

    if (cErr || !contact?.id) {
      return NextResponse.json(
        { ok: false, error: `Contacto: ${cErr?.message ?? "error"}` },
        { status: 500 }
      );
    }
    const contactId = contact.id as string;

    if (name && name !== contact.name) {
      await supabase
        .from("chat_contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", contactId)
        .eq("empresa_id", empresaId);
    }

    const tenantDataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    await ensureCentralChatChannelMirror({ pool, tenantDataSchema, empresaId, channelId });
    await ensureCentralChatContactMirror({ pool, tenantDataSchema, empresaId, contactId });

    const { data: existing } = await supabase
      .from("chat_conversations")
      .select("id, status")
      .eq("contact_id", contactId)
      .eq("channel_id", channelId)
      .maybeSingle();

    if (existing?.id) {
      // Una conversación cerrada se reabre: el operador la está retomando.
      if (existing.status === "closed") {
        await supabase
          .from("chat_conversations")
          .update({ status: "open", updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("empresa_id", empresaId);
        await ensureCentralChatConversationMirror({
          pool,
          tenantDataSchema,
          empresaId,
          conversationId: existing.id as string,
        });
      }
      return NextResponse.json({
        ok: true,
        created: false,
        conversation_id: existing.id,
        contact_id: contactId,
        phone,
      });
    }

    // Chat iniciado por una persona: arranca en modo humano, sin bootear el flujo
    // del bot (el cliente todavía no escribió nada a lo que el bot deba responder).
    const { data: conv, error: convErr } = await supabase
      .from("chat_conversations")
      .insert({
        empresa_id: empresaId,
        channel_id: channelId,
        contact_id: contactId,
        status: "open",
        flow_code: null,
        flow_current_node: null,
        flow_status: "human",
        human_taken_over: true,
        last_message_at: null,
        last_message_preview: null,
        unread_count: 0,
      })
      .select("id")
      .single();

    if (convErr || !conv?.id) {
      console.warn(LOG, "insert_error", { empresa_id: empresaId, err: convErr?.message });
      return NextResponse.json(
        { ok: false, error: `Conversación: ${convErr?.message ?? "error"}` },
        { status: 500 }
      );
    }

    await ensureCentralChatConversationMirror({
      pool,
      tenantDataSchema,
      empresaId,
      conversationId: conv.id as string,
    });

    return NextResponse.json({
      ok: true,
      created: true,
      conversation_id: conv.id,
      contact_id: contactId,
      phone,
    });
  } catch (err) {
    console.error(LOG, "unhandled", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error inesperado" },
      { status: 500 }
    );
  }
}
