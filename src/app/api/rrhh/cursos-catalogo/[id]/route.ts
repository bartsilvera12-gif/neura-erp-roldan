import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const TIPOS = ["curso","certificado","habilitacion","documento_legal"];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.nombre !== undefined) update.nombre = String(body.nombre).trim();
    if (body.slug !== undefined) update.slug = String(body.slug).trim();
    if (body.tipo !== undefined) {
      const t = String(body.tipo);
      if (!TIPOS.includes(t)) return NextResponse.json(errorResponse("tipo inválido"), { status: 400 });
      update.tipo = t;
    }
    if (body.entidad_emisora_default !== undefined)
      update.entidad_emisora_default = body.entidad_emisora_default ? String(body.entidad_emisora_default) : null;
    if (body.duracion_dias !== undefined)
      update.duracion_dias = body.duracion_dias === null || body.duracion_dias === "" ? null : Number(body.duracion_dias);
    if (body.activo !== undefined) update.activo = Boolean(body.activo);
    if (body.orden !== undefined) update.orden = Number(body.orden) || 0;

    const { error } = await ctx.supabase
      .from("cursos_catalogo").update(update)
      .eq("id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const { error } = await ctx.supabase
      .from("cursos_catalogo").delete()
      .eq("id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
