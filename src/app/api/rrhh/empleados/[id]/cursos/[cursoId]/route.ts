import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { EMPLEADO_ARCHIVOS_BUCKET } from "@/lib/rrhh/empleado-archivos-storage";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; cursoId: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id, cursoId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["nombre","tipo","entidad_emisora","observaciones","estado"]) {
      if (body[k] !== undefined) update[k] = body[k] ? String(body[k]).trim() || null : null;
    }
    for (const k of ["fecha_emision","fecha_vencimiento"]) {
      if (body[k] !== undefined) update[k] = body[k] ? String(body[k]) : null;
    }
    const { error } = await ctx.supabase
      .from("empleado_cursos").update(update)
      .eq("id", cursoId).eq("empleado_id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; cursoId: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id, cursoId } = await params;
    const sel = await ctx.supabase
      .from("empleado_cursos")
      .select("id, storage_path, storage_bucket")
      .eq("id", cursoId).eq("empleado_id", id).eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();
    if (sel.error) return NextResponse.json(errorResponse(sel.error.message), { status: 400 });
    if (!sel.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const row = sel.data as { storage_path: string | null; storage_bucket: string | null };
    if (row.storage_path) {
      await ctx.supabase.storage.from(row.storage_bucket || EMPLEADO_ARCHIVOS_BUCKET).remove([row.storage_path]);
    }
    const del = await ctx.supabase
      .from("empleado_cursos").delete()
      .eq("id", cursoId).eq("empleado_id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
