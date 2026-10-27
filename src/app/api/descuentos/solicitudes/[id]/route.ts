import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { leerSolicitud } from "@/lib/descuentos/server/solicitudes";

/**
 * GET — cómo viene mi pedido. La pantalla de Caja la consulta cada pocos
 * segundos mientras espera, con el cliente adelante.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const s = await leerSolicitud(ctx.supabase, ctx.auth.empresa_id, id);
    if (!s) return NextResponse.json(errorResponse("Pedido no encontrado."), { status: 404 });
    // El vendedor ve el suyo; el administrador, cualquiera.
    if (s.solicitante_id !== (ctx.auth.usuarioCatalogId ?? "") && !isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Ese pedido no es tuyo."), { status: 403 });
    }
    return NextResponse.json(successResponse({ solicitud: s }));
  } catch (err) {
    console.error("[/api/descuentos/solicitudes/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo consultar el pedido."), { status: 500 });
  }
}
