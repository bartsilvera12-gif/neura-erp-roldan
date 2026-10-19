import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctxParams.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (typeof body.nombre === "string" && body.nombre.trim()) update.nombre = body.nombre.trim();
    if (body.activo !== undefined) update.activo = Boolean(body.activo);
    if (typeof body.orden === "number" && Number.isFinite(body.orden)) {
      update.orden = Math.max(0, Math.min(32000, Math.trunc(body.orden)));
    }
    const { data, error } = await ctx.supabase
      .from("departamentos_catalogo").update(update)
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id).select().single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ departamento: data }));
  } catch (err) {
    console.error("[/api/rrhh/departamentos-catalogo/:id PATCH]", err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctxParams.params;
    // Soft delete: no borrar es_sistema, solo desactivar
    const { data: row } = await ctx.supabase
      .from("departamentos_catalogo").select("es_sistema")
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle();
    if (!row) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
    if ((row as { es_sistema: boolean }).es_sistema) {
      const { error } = await ctx.supabase
        .from("departamentos_catalogo").update({ activo: false })
        .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
      return NextResponse.json(successResponse({ ok: true, soft: true }));
    }
    const { error } = await ctx.supabase
      .from("departamentos_catalogo").delete()
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/rrhh/departamentos-catalogo/:id DELETE]", err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}
