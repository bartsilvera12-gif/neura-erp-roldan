import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** Cambio de estado: aprobar / rechazar / cancelar. La conversión a venta va aparte. */
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctxParams.params;
    const body = (await request.json().catch(() => ({}))) as {
      estado?: unknown; motivo_rechazo?: unknown; observaciones?: unknown;
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.estado === "string") {
      const e = body.estado.trim();
      const valid = ["pendiente", "aprobada", "procesada", "rechazada", "cancelada"];
      if (!valid.includes(e)) {
        return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
      }
      patch.estado = e;
      if (e === "rechazada" && typeof body.motivo_rechazo === "string") {
        patch.motivo_rechazo = body.motivo_rechazo.trim() || null;
      }
    }
    if (typeof body.observaciones === "string") patch.observaciones = body.observaciones.trim() || null;
    const { data, error } = await ctx.supabase
      .from("ordenes_venta")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id, estado, motivo_rechazo, observaciones")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ orden: data }));
  } catch (err) {
    console.error("[/api/ordenes-venta/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la orden."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctxParams.params;
    // Borrar items (por si no hay CASCADE), después la orden.
    await ctx.supabase.from("ordenes_venta_items").delete().eq("orden_id", id);
    const { error } = await ctx.supabase.from("ordenes_venta").delete().eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/ordenes-venta/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la orden."), { status: 500 });
  }
}
