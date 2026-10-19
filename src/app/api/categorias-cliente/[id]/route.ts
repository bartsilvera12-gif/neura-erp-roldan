import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.nombre !== undefined) patch.nombre = String(body.nombre).trim();
    if (body.orden !== undefined) patch.orden = Number(body.orden) || 0;
    if (body.activa !== undefined) patch.activa = body.activa === true;
    const { data, error } = await ctx.supabase
      .from("categorias_cliente")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id, nombre, orden, activa")
      .maybeSingle();
    if (error) {
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Ya existe una categoría con ese nombre."), { status: 409 });
      }
      throw new Error(error.message);
    }
    if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ categoria: data }));
  } catch (err) {
    console.error("[/api/categorias-cliente/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la categoría."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { error } = await ctx.supabase
      .from("categorias_cliente")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (error) {
      if (/23503|foreign key/i.test(error.message)) {
        return NextResponse.json(
          errorResponse("La categoría está asignada a clientes o tiene precios cargados. Desactivala en su lugar."),
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/categorias-cliente/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la categoría."), { status: 500 });
  }
}
