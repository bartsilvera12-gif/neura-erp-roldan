/**
 * Salud de los canales de WhatsApp por QR (puente Baileys), para avisar en la
 * campana cuando el número quedó desvinculado.
 *
 * El estado de un canal QR NO está en la base: vive en el puente, que lo
 * informa en `GET {bridge_url}/status`. Hasta ahora eso solo se veía si
 * alguien abría la pantalla de conexión del canal
 * (`/configuracion/canales/[channelId]`), así que el número podía quedar
 * desvinculado — se cierra la sesión desde el celular, se reinicia el puente —
 * y nadie se enteraba hasta que un cliente reclamaba que no le contestaban.
 *
 * Por qué no reusa `getBaileysChannelStatus` de `chat/actions.ts`:
 *   - esa función no tiene timeout, y acá la llama la campana, que se refresca
 *     sola: un puente colgado dejaría colgada la respuesta de
 *     `/api/notificaciones`;
 *   - además genera la imagen del QR, que para un aviso no hace falta.
 * Lo que sí reusa es `fetchChatChannels()`, que ya resuelve los dos caminos de
 * lectura (PostgREST y pool de Postgres para el schema no expuesto) y trae su
 * propia caché.
 */
import { fetchChatChannels } from "@/lib/chat/actions";
import { consultarPuenteQr, esCanalQr, type EstadoCanalQr } from "@/lib/chat/baileys-bridge-status";

/** El resultado se reusa este rato: la campana pregunta cada minuto. */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; canales: EstadoCanalQr[] }>();

/**
 * Los canales QR de la empresa que NO están vinculados ahora mismo.
 * Vacío si todos están conectados, si no hay canales QR, o si no se pudo
 * averiguar: no inventa un aviso cuando no sabe.
 */
export async function canalesQrCaidos(empresaId: string): Promise<EstadoCanalQr[]> {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) return [];

  const hit = cache.get(empresaId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.canales;

  let canales: Awaited<ReturnType<typeof fetchChatChannels>>;
  try {
    canales = await fetchChatChannels();
  } catch {
    return [];
  }

  const qr = canales.filter(esCanalQr);
  if (qr.length === 0) {
    cache.set(empresaId, { at: Date.now(), canales: [] });
    return [];
  }

  const estados = await Promise.all(
    qr.map(async (c): Promise<EstadoCanalQr> => {
      const { connection, detalle } = await consultarPuenteQr(
        String(c.config.baileys_bridge_url),
        secret
      );
      return {
        channelId: String(c.id),
        nombre: c.nombre?.trim() || "WhatsApp por QR",
        connection,
        detalle,
      };
    })
  );

  const caidos = estados.filter((e) => e.connection !== "open");
  cache.set(empresaId, { at: Date.now(), canales: caidos });
  return caidos;
}

export { textoEstadoQr } from "@/lib/chat/baileys-bridge-status";
export type { EstadoCanalQr } from "@/lib/chat/baileys-bridge-status";
