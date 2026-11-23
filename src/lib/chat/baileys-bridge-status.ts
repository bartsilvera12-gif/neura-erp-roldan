/**
 * Consulta el estado de un puente Baileys (WhatsApp por QR), sin tocar la base.
 *
 * Está separado de `baileys-health.ts` a propósito: acá no hay nada que
 * dependa del tenant, de Supabase ni de server actions, así que se puede
 * probar solo (ver `scripts/test-whatsapp-qr-aviso.ts`).
 */

/** Cuánto esperamos al puente antes de darlo por caído. */
export const TIMEOUT_PUENTE_MS = 2500;

export type ConexionQr = "starting" | "qr" | "open" | "close" | "unknown";

export type EstadoCanalQr = {
  channelId: string;
  nombre: string;
  /** `open` = vinculado. El resto es "no está atendiendo". */
  connection: ConexionQr;
  /** Texto corto de por qué, cuando se sabe. */
  detalle: string | null;
};

/**
 * `GET {bridgeUrl}/status`. Nunca lanza: un puente apagado, un DNS que no
 * resuelve o un timeout son, para quien atiende, lo mismo que caído.
 */
export async function consultarPuenteQr(
  bridgeUrl: string,
  secret: string,
  timeoutMs = TIMEOUT_PUENTE_MS
): Promise<{ connection: ConexionQr; detalle: string | null }> {
  const url = `${bridgeUrl.trim().replace(/\/+$/, "")}/status`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-bridge-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { connection: "unknown", detalle: `El puente respondió ${res.status}.` };
    const data = (await res.json()) as { connection?: string };
    const raw = String(data?.connection ?? "");
    if (raw === "starting" || raw === "qr" || raw === "open" || raw === "close") {
      return { connection: raw, detalle: null };
    }
    return { connection: "unknown", detalle: null };
  } catch {
    return { connection: "unknown", detalle: "No se pudo contactar al puente." };
  }
}

/** Un canal de la base es un canal QR vivo que vale la pena consultar. */
export function esCanalQr(c: {
  provider?: string | null;
  activo?: boolean;
  config?: Record<string, unknown> | null;
}): boolean {
  if (String(c.provider ?? "").toLowerCase() !== "baileys") return false;
  if (c.activo === false) return false;
  const url = c.config?.baileys_bridge_url;
  return typeof url === "string" && url.trim().length > 0;
}

/** Cómo se le explica el estado a quien lee el aviso de la campana. */
export function textoEstadoQr(e: Pick<EstadoCanalQr, "connection" | "detalle">): string {
  if (e.connection === "qr") return "Está esperando que escaneen el QR";
  if (e.connection === "close") return "Se cerró la sesión del número";
  if (e.connection === "starting") return "El puente está arrancando";
  return e.detalle ?? "No se sabe el estado del puente";
}
