import "server-only";

/**
 * Mandar un correo.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
 *   El sistema no tenía NINGUNA forma de mandar mails: ni nodemailer, ni SMTP,
 *   ni una variable de entorno de correo. Lo único cableado era WhatsApp.
 *
 * ── POR QUÉ RESEND Y POR QUÉ CON `fetch` PELADO ────────────────────────────
 *   Su API es un POST con JSON, así que no hace falta agregar una dependencia
 *   para hablarle. Una dependencia menos es una menos que mantener, auditar y
 *   romper en el próximo build.
 *
 * ── QUÉ PASA SI NO ESTÁ CONFIGURADO ────────────────────────────────────────
 *   Nada explota: `emailConfigurado()` devuelve false y la pantalla ofrece
 *   abrir el correo de la persona con el mensaje ya escrito. El pedido se
 *   manda igual, desde su casilla. Cuando carguen la clave, el mismo botón
 *   pasa a enviar solo.
 *
 * ── CONFIGURACIÓN ──────────────────────────────────────────────────────────
 *   RESEND_API_KEY   — la clave de la cuenta.
 *   EMAIL_FROM       — remitente, p. ej. "Roldán e Hijos <compras@roldan.com.py>".
 *                      El dominio tiene que estar VERIFICADO en Resend o los
 *                      correos caen en spam o los rechaza el destinatario.
 *   EMAIL_REPLY_TO   — opcional: a dónde contesta el proveedor. Normalmente la
 *                      casilla de quien hace los pedidos, no la del sistema.
 */

const API = "https://api.resend.com/emails";

export interface EmailAEnviar {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** Pisa EMAIL_REPLY_TO para este envío. */
  responderA?: string | null;
}

export type ResultadoEnvio =
  | { ok: true; id: string | null }
  | { ok: false; motivo: string; sinConfigurar?: boolean };

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Qué falta, en palabras, para poder decírselo a quien configura. */
export function queFaltaParaEmail(): string {
  const falta: string[] = [];
  if (!process.env.RESEND_API_KEY) falta.push("RESEND_API_KEY");
  if (!process.env.EMAIL_FROM) falta.push("EMAIL_FROM");
  return falta.join(" y ");
}

export async function enviarEmail(m: EmailAEnviar): Promise<ResultadoEnvio> {
  if (!emailConfigurado()) {
    return {
      ok: false,
      sinConfigurar: true,
      motivo:
        `El envío de correos no está configurado: falta ${queFaltaParaEmail()} ` +
        "en las variables de entorno.",
    };
  }

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [m.para],
        subject: m.asunto,
        html: m.html,
        text: m.texto,
        ...(m.responderA || process.env.EMAIL_REPLY_TO
          ? { reply_to: m.responderA || process.env.EMAIL_REPLY_TO }
          : {}),
      }),
      // Un correo que tarda más que esto no se va a mandar igual, y mientras
      // tanto deja la pantalla colgada.
      signal: AbortSignal.timeout(15_000),
    });

    const cuerpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!r.ok) {
      // El mensaje del proveedor dice cosas accionables ("domain is not
      // verified"), así que se pasa tal cual en vez de taparlo con un genérico.
      return { ok: false, motivo: cuerpo.message || `El servidor de correo respondió ${r.status}.` };
    }
    return { ok: true, id: cuerpo.id ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return {
      ok: false,
      motivo: /timeout|abort/i.test(msg)
        ? "El servidor de correo no respondió a tiempo."
        : `No se pudo contactar al servidor de correo: ${msg}`,
    };
  }
}
