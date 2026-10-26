import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = normalizeUpperText(body.nombre);
    if (body.codigo !== undefined) patch.codigo = normalizeUpperNullable(body.codigo);
    if (body.descripcion !== undefined) patch.descripcion = normalizeUpperNullable(body.descripcion);
    if (body.parent_id !== undefined) patch.parent_id = body.parent_id == null ? null : String(body.parent_id);
    if (body.activo !== undefined) patch.activo = body.activo === true;

    if (Object.keys(patch).length === 0) {
      const { data, error } = await ctx.supabase
        .from("categorias_productos")
        .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
      return NextResponse.json(successResponse({ categoria: data }));
    }

    const upd = await ctx.supabase
      .from("categorias_productos")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
      .maybeSingle();
    if (upd.error) {
      const msg = upd.error.message ?? "";
      if (/duplicate|unique|23505/i.test(msg)) {
        return NextResponse.json(errorResponse("Ya existe un rubro con ese nombre o código."), {
          status: 409,
        });
      }
      console.error("[/api/inventario/categorias/[id] PATCH]", msg);
      return NextResponse.json(errorResponse("No se pudo actualizar el rubro."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ categoria: upd.data }));
  } catch (err) {
    console.error("[/api/inventario/categorias/[id] PATCH] outer", err);
    return NextResponse.json(errorResponse("No se pudo actualizar el rubro."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const del = await ctx.supabase
      .from("categorias_productos")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (del.error) {
      const msg = del.error.message ?? "";
      // FK: rubro en uso por algún producto
      if (/23503|foreign key|violates/i.test(msg)) {
        return NextResponse.json(
          errorResponse("No se puede borrar: el rubro está asignado a productos. Desactivalo en su lugar."),
          { status: 409 }
        );
      }
      console.error("[/api/inventario/categorias/[id] DELETE]", msg);
      return NextResponse.json(errorResponse("No se pudo borrar el rubro."), { status: 500 });
    }
    if (!del.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/inventario/categorias/[id] DELETE] outer", err);
    return NextResponse.json(errorResponse("No se pudo borrar el rubro."), { status: 500 });
  }
}
