import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { leerSolicitud, resolverSolicitud } from "@/lib/descuentos/server/solicitudes";

/**
 * POST — el administrador aprueba o rechaza.
 *
 * Nadie se autoriza a sí mismo: si el que pide es el mismo que contesta, el
 * tope no significa nada. Un administrador no necesita pedir —no tiene tope—,
 * así que el caso solo aparecería forzándolo a mano.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo un administrador puede autorizar descuentos."), { status: 403 });
    }

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const aprobar = b.aprobar === true;
    const motivo = typeof b.motivo === "string" && b.motivo.trim() ? b.motivo.trim().slice(0, 500) : null;

    const actual = await leerSolicitud(ctx.supabase, ctx.auth.empresa_id, id);
    if (!actual) return NextResponse.json(errorResponse("Pedido no encontrado."), { status: 404 });
    if (actual.solicitante_id === (ctx.auth.usuarioCatalogId ?? "")) {
      return NextResponse.json(errorResponse("No podés autorizar tu propio pedido."), { status: 403 });
    }
    if (actual.estado !== "pendiente") {
      return NextResponse.json(
        errorResponse(`Ese pedido ya está ${actual.estado}.`),
        { status: 409 }
      );
    }
    if (actual.vencida) {
      return NextResponse.json(
        errorResponse("El pedido venció. El vendedor tiene que volver a pedirlo."),
        { status: 409 }
      );
    }

    const s = await resolverSolicitud(ctx.supabase, ctx.auth.empresa_id, id, {
      aprobar,
      porId: ctx.auth.usuarioCatalogId ?? null,
      porNombre: ctx.auth.nombre ?? null,
      motivo,
    });
    if (!s) {
      // Perdió la carrera contra otro administrador.
      return NextResponse.json(errorResponse("Otro usuario acaba de contestar ese pedido."), { status: 409 });
    }
    return NextResponse.json(successResponse({ solicitud: s }));
  } catch (err) {
    console.error("[/api/descuentos/solicitudes/[id]/resolver POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo contestar el pedido."), { status: 500 });
  }
}
