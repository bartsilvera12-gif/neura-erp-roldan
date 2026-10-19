import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

function esAdmin(rol: string | null | undefined): boolean {
  const r = (rol ?? "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

/** PATCH /api/configuracion/sucursales/[id] — editar nombre, activa, establecimiento, punto_expedicion. */
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const { id } = await ctxParams.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = String(body.nombre).trim();
    if (body.activa !== undefined) patch.activa = body.activa === true;
    if (body.establecimiento !== undefined) patch.establecimiento = body.establecimiento == null ? null : String(body.establecimiento).trim() || null;
    if (body.punto_expedicion !== undefined) patch.punto_expedicion = body.punto_expedicion == null ? null : String(body.punto_expedicion).trim() || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    const sr = createServiceRoleClient();
    const { data, error } = await sr
      .from("sucursales")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id)
      .select("id, codigo, nombre, es_principal, activa, establecimiento, punto_expedicion")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ sucursal: data }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la sucursal."), { status: 500 });
  }
}

/** DELETE /api/configuracion/sucursales/[id] — solo si NO es principal y no tiene datos operativos. */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const { id } = await ctxParams.params;
    const sr = createServiceRoleClient();

    // Check principal
    const { data: suc } = await sr
      .from("sucursales")
      .select("id, empresa_id, es_principal")
      .eq("id", id)
      .maybeSingle();
    if (!suc || (suc as { empresa_id?: string }).empresa_id !== ctx.auth.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }
    if ((suc as { es_principal?: boolean }).es_principal) {
      return NextResponse.json(errorResponse("No se puede borrar la sucursal principal."), { status: 409 });
    }

    const { error } = await sr.from("sucursales").delete().eq("id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (error) {
      if (/23503|foreign key|violates/i.test(error.message)) {
        return NextResponse.json(
          errorResponse("La sucursal tiene datos operativos asociados. Desactivala en su lugar."),
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la sucursal."), { status: 500 });
  }
}
