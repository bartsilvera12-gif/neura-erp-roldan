import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { UMBRAL_PROXIMO } from "@/lib/lotes/nivel";

/**
 * GET /api/lotes/count-notificaciones — endpoint liviano para el badge del header.
 * Devuelve el número de lotes activos con cantidad>0 y fecha_vencimiento <= hoy + 15 días.
 * Incluye los vencidos (los más urgentes).
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const hoy = new Date();
    const hasta = new Date(hoy);
    hasta.setUTCDate(hasta.getUTCDate() + UMBRAL_PROXIMO);
    const hastaIso = hasta.toISOString().slice(0, 10);

    const { count, error } = await ctx.supabase
      .from("producto_lotes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("activo", true)
      .gt("cantidad", 0)
      .lte("fecha_vencimiento", hastaIso);

    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ count: count ?? 0 }));
  } catch (err) {
    console.error("[/api/lotes/count-notificaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener el conteo."), { status: 500 });
  }
}
