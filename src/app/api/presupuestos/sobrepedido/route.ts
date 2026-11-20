import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { sobrepedido } from "@/lib/notificaciones/server/notificaciones";

/**
 * GET /api/presupuestos/sobrepedido — el material que piden los presupuestos
 * vigentes y que no alcanza con el stock (pedido del cliente: «sobrepedido»).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const filas = await sobrepedido(ctx.supabase, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ filas }));
  } catch (err) {
    console.error("[/api/presupuestos/sobrepedido]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo armar el sobrepedido."), { status: 500 });
  }
}
