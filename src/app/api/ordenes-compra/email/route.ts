import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { emailConfigurado, enviarEmail, queFaltaParaEmail } from "@/lib/email/enviar";
import {
  asuntoDeOrden, cuerpoHtml, cuerpoTexto, emailValido, mailtoDeOrden,
  type ItemOrdenEmail, type OrdenParaEmail,
} from "@/lib/ordenes-compra/email-orden";

export const runtime = "nodejs";

/**
 * Mandarle la orden de compra al vendedor del proveedor.
 *
 * GET  ?id=…  — qué se puede hacer con esta orden: a quién iría, si hay
 *               servidor de correo, y el `mailto:` ya armado por si no lo hay.
 * POST { id } — la manda de verdad.
 *
 * ── POR QUÉ EL GET DEVUELVE EL MAILTO ──────────────────────────────────────
 *   Hoy no hay servidor de correo configurado. En vez de dejar el botón
 *   muerto, la pantalla abre el correo de la persona con el destinatario, el
 *   asunto y el cuerpo ya escritos: el pedido sale igual, desde su casilla, y
 *   la respuesta del proveedor le llega a ella. Cuando carguen la clave, el
 *   mismo botón pasa a enviar solo.
 *
 * ── UNA ORDEN POR VEZ ──────────────────────────────────────────────────────
 *   No hay envío masivo a propósito. Mandar correos a proveedores de verdad es
 *   una acción que sale del sistema y no se puede deshacer; que cada uno
 *   necesite un clic es la diferencia entre un error de una orden y un error
 *   de cuarenta.
 */

type FilaOrden = {
  id: string;
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  fecha: string;
  moneda: string;
  estado: string;
  observaciones: string | null;
  items: ItemOrdenEmail[] | null;
};

/** La orden, el mail del proveedor y el nombre de su vendedor. */
async function contexto(
  ctx: NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>,
  id: string
) {
  const oQ = await ctx.supabase
    .from("ordenes_compra")
    .select("id, numero_control, proveedor_id, proveedor_nombre, fecha, moneda, estado, observaciones, items")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (oQ.error) throw new Error(oQ.error.message);
  if (!oQ.data) return null;
  const o = oQ.data as unknown as FilaOrden;

  let email: string | null = null;
  let contacto: string | null = null;
  if (o.proveedor_id) {
    const pQ = await ctx.supabase
      .from("proveedores")
      .select("email, contacto")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", o.proveedor_id)
      .maybeSingle();
    if (!pQ.error && pQ.data) {
      const p = pQ.data as { email?: string | null; contacto?: string | null };
      email = (p.email ?? "").trim() || null;
      contacto = (p.contacto ?? "").trim() || null;
    }
  }

  const orden: OrdenParaEmail = {
    numero_control: o.numero_control,
    proveedor_nombre: o.proveedor_nombre,
    contacto,
    fecha: o.fecha,
    moneda: o.moneda,
    observaciones: o.observaciones,
    items: Array.isArray(o.items) ? o.items : [],
  };
  return { o, orden, email };
}

function emisorDe(req: NextRequest, nombreUsuario?: string | null, ordenId?: string) {
  const origen = new URL(req.url).origin;
  return {
    empresa: process.env.NEXT_PUBLIC_EMPRESA_NOMBRE || "Aceros Metal Roldán e Hijos",
    firmante: nombreUsuario ?? null,
    linkImprimir: ordenId ? `${origen}/api/ordenes-compra/imprimir?id=${ordenId}` : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta la orden."), { status: 400 });

    const c = await contexto(ctx, id);
    if (!c) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });

    const emisor = emisorDe(request, ctx.auth.user?.email ?? null, id);
    const tieneEmail = emailValido(c.email);

    return NextResponse.json(successResponse({
      email: c.email,
      email_valido: tieneEmail,
      contacto: c.orden.contacto,
      proveedor_nombre: c.orden.proveedor_nombre,
      servidor_configurado: emailConfigurado(),
      falta_configurar: emailConfigurado() ? null : queFaltaParaEmail(),
      asunto: asuntoDeOrden(c.orden, emisor.empresa),
      // Para abrir el correo de la persona cuando no hay servidor.
      mailto: tieneEmail ? mailtoDeOrden(c.orden, emisor, c.email!) : null,
    }));
  } catch (err) {
    console.error("[/api/ordenes-compra/email GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo preparar el correo."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta la orden."), { status: 400 });

    const c = await contexto(ctx, id);
    if (!c) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });

    if (c.o.estado === "anulada") {
      return NextResponse.json(
        errorResponse("Esa orden está anulada: no tiene sentido mandarla."),
        { status: 409 }
      );
    }
    if (c.orden.items.length === 0) {
      return NextResponse.json(errorResponse("La orden no tiene artículos."), { status: 409 });
    }

    // El destinatario puede venir escrito a mano, para el proveedor al que
    // todavía no le cargaron el mail en la ficha. 386 de 418 están así.
    const destino = String(body.email ?? "").trim() || c.email || "";
    if (!emailValido(destino)) {
      return NextResponse.json(
        errorResponse(
          c.email
            ? `El mail del proveedor no parece válido: "${c.email}".`
            : `${c.orden.proveedor_nombre} no tiene mail cargado. Escribilo en la ficha del proveedor, o pasalo en este envío.`
        ),
        { status: 400 }
      );
    }

    const emisor = emisorDe(request, ctx.auth.user?.email ?? null, id);
    const r = await enviarEmail({
      para: destino,
      asunto: asuntoDeOrden(c.orden, emisor.empresa),
      html: cuerpoHtml(c.orden, emisor),
      texto: cuerpoTexto(c.orden, emisor),
      responderA: ctx.auth.user?.email ?? null,
    });

    if (!r.ok) {
      return NextResponse.json(
        errorResponse(r.motivo),
        { status: r.sinConfigurar ? 503 : 502 }
      );
    }

    return NextResponse.json(successResponse({
      ok: true,
      enviado_a: destino,
      contacto: c.orden.contacto,
      id: r.id,
    }));
  } catch (err) {
    console.error("[/api/ordenes-compra/email POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo mandar el correo."), { status: 500 });
  }
}
