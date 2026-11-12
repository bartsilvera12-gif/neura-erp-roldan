import type { Pool } from "pg";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { getOmnicanalScope, shouldBypassOmnicanalConversationScope } from "@/lib/chat/omnicanal-scope";
import {
  pgResolveChannelIdsForQueueIds,
  pgSelectChatAgentIdsForUsuarios,
  pgSelectQueueIdsForAgentUsuarios,
} from "@/lib/chat/omnicanal-scope-pg";

/**
 * Qué prospectos del CRM ve cada persona.
 *
 * Un asesor ve los clientes que le escribieron a SU número (los canales de
 * sus colas) o cuyos chats tiene asignados, más los prospectos que cargó o
 * tiene a su nombre. Antes veía el embudo de toda la empresa: los clientes de
 * todos los Corporativos.
 *
 * Administración (quien ve todas las conversaciones) ve todo: devuelve null.
 * Si algo falla, no se muestra nada ajeno: devuelve un conjunto vacío.
 */
export async function prospectosVisibles(args: {
  pool: Pool;
  dataSchema: string;
  supabase: AppSupabaseClient;
  empresaId: string;
  usuarioId: string | null;
  nombre: string | null;
  email: string | null;
}): Promise<{ ids: Set<string>; nombres: string[] } | null> {
  const { pool, dataSchema, supabase, empresaId } = args;
  const uid = (args.usuarioId ?? "").trim();
  if (!uid) return { ids: new Set(), nombres: [] };

  const scope = await getOmnicanalScope(supabase, empresaId, uid, { tenantDataSchema: dataSchema });
  if (await shouldBypassOmnicanalConversationScope(createServiceRoleClient(), uid, scope)) return null;

  let nombre = args.nombre;
  if (!nombre) {
    try {
      const { data } = await createServiceRoleClient().from("usuarios").select("nombre").eq("id", uid).maybeSingle();
      nombre = (data as { nombre?: string | null } | null)?.nombre ?? null;
    } catch { /* sin nombre, se compara por correo */ }
  }
  const nombres = [nombre, args.email].map((x) => (x ?? "").trim().toLowerCase()).filter(Boolean);
  try {
    const agentes = await pgSelectChatAgentIdsForUsuarios(pool, dataSchema, empresaId, scope.agentUsuarioIds, true);
    const colas = [
      ...new Set([...(scope.queueIds ?? []), ...(await pgSelectQueueIdsForAgentUsuarios(pool, dataSchema, empresaId, scope.agentUsuarioIds))]),
    ];
    const canales = colas.length ? await pgResolveChannelIdsForQueueIds(pool, dataSchema, empresaId, colas) : [];
    if (agentes.length === 0 && canales.length === 0) return { ids: new Set(), nombres };

    const ct = quoteSchemaTable(dataSchema, "chat_contacts");
    const cv = quoteSchemaTable(dataSchema, "chat_conversations");
    const r = await pool.query(
      `SELECT DISTINCT ct.crm_prospecto_id::text AS id
         FROM ${ct} ct
         JOIN ${cv} c ON c.contact_id = ct.id AND c.empresa_id = ct.empresa_id
        WHERE ct.empresa_id = $1::uuid AND ct.crm_prospecto_id IS NOT NULL
          AND (c.assigned_agent_id = ANY($2::uuid[]) OR c.channel_id = ANY($3::uuid[]))`,
      [empresaId, agentes, canales]
    );
    return {
      ids: new Set((r.rows ?? []).map((x: { id?: string }) => String(x.id ?? "")).filter(Boolean)),
      nombres,
    };
  } catch (e) {
    console.warn("[crm][alcance] se muestra solo lo propio:", e instanceof Error ? e.message : e);
    return { ids: new Set(), nombres };
  }
}

/** Aplica el alcance a una lista de prospectos. */
export function filtrarProspectos<T extends { id?: unknown; responsable?: unknown; creado_por?: unknown }>(
  lista: T[],
  alcance: { ids: Set<string>; nombres: string[] } | null
): T[] {
  if (!alcance) return lista;
  const propio = (v: unknown) => {
    const s = String(v ?? "").trim().toLowerCase();
    return !!s && alcance.nombres.includes(s);
  };
  return lista.filter((p) => alcance.ids.has(String(p.id ?? "")) || propio(p.responsable) || propio(p.creado_por));
}
