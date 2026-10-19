import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const ESTADOS = new Set(["pendiente", "aprobada", "rechazada", "cancelada"]);

/**
 * PATCH /api/rrhh/vacaciones/[id]
 * Body: { estado: 'aprobada' | 'rechazada' | 'pendiente' | 'cancelada' }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { estado?: string };
    const estado = String(body.estado ?? "").trim();
    if (!ESTADOS.has(estado)) return NextResponse.json(errorResponse("estado inválido"), { status: 400 });

    const ahora = new Date().toISOString();
    const update: Record<string, unknown> = {
      estado,
      aprobado_at: estado === "aprobada" ? ahora : null,
      cancelado_at: estado === "cancelada" ? ahora : null,
    };

    const { error } = await ctx.supabase
      .from("empleado_vacaciones")
      .update(update)
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id);

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
