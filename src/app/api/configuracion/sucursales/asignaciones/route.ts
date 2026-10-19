import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

function esAdmin(rol: string | null | undefined): boolean {
  const r = (rol ?? "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

async function usuarioPerteneceEmpresa(usuarioId: string, empresaId: string): Promise<boolean> {
  const sr = createServiceRoleClient();
  const { data } = await sr.from("usuarios").select("id, empresa_id").eq("id", usuarioId).maybeSingle();
  return !!data && (data as { empresa_id?: string }).empresa_id === empresaId;
}
async function sucursalPerteneceEmpresa(sucursalId: string, empresaId: string): Promise<boolean> {
  const sr = createServiceRoleClient();
  const { data } = await sr.from("sucursales").select("id, empresa_id").eq("id", sucursalId).maybeSingle();
  return !!data && (data as { empresa_id?: string }).empresa_id === empresaId;
}

/** GET — matriz completa de asignaciones (usuario_id, sucursal_id) para la empresa. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const sr = createServiceRoleClient();
    // Traer todos los usuarios de la empresa y sus asignaciones vigentes.
    const { data: userIdsData } = await sr.from("usuarios").select("id").eq("empresa_id", ctx.auth.empresa_id);
    const userIds = ((userIdsData ?? []) as { id: string }[]).map((u) => u.id);
    if (userIds.length === 0) return NextResponse.json(successResponse({ asignaciones: [] }));
    const { data, error } = await sr
      .from("usuario_sucursales")
      .select("usuario_id, sucursal_id")
      .in("usuario_id", userIds);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ asignaciones: data ?? [] }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/asignaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las asignaciones."), { status: 500 });
  }
}

/** POST — asignar usuario a sucursal. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as { usuario_id?: unknown; sucursal_id?: unknown };
    const usuarioId = String(body.usuario_id ?? "").trim();
    const sucursalId = String(body.sucursal_id ?? "").trim();
    if (!usuarioId || !sucursalId) {
      return NextResponse.json(errorResponse("Faltan usuario_id o sucursal_id."), { status: 400 });
    }
    if (!(await usuarioPerteneceEmpresa(usuarioId, ctx.auth.empresa_id ?? ""))) {
      return NextResponse.json(errorResponse("Usuario fuera de tu empresa."), { status: 403 });
    }
    if (!(await sucursalPerteneceEmpresa(sucursalId, ctx.auth.empresa_id ?? ""))) {
      return NextResponse.json(errorResponse("Sucursal fuera de tu empresa."), { status: 403 });
    }
    const sr = createServiceRoleClient();
    const { error } = await sr
      .from("usuario_sucursales")
      .upsert(
        { usuario_id: usuarioId, sucursal_id: sucursalId, es_default: false },
        { onConflict: "usuario_id,sucursal_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/asignaciones POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo asignar."), { status: 500 });
  }
}

/** DELETE — quitar asignación. */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as { usuario_id?: unknown; sucursal_id?: unknown };
    const usuarioId = String(body.usuario_id ?? "").trim();
    const sucursalId = String(body.sucursal_id ?? "").trim();
    if (!usuarioId || !sucursalId) {
      return NextResponse.json(errorResponse("Faltan usuario_id o sucursal_id."), { status: 400 });
    }
    if (!(await usuarioPerteneceEmpresa(usuarioId, ctx.auth.empresa_id ?? ""))) {
      return NextResponse.json(errorResponse("Usuario fuera de tu empresa."), { status: 403 });
    }
    const sr = createServiceRoleClient();
    const { error } = await sr
      .from("usuario_sucursales")
      .delete()
      .eq("usuario_id", usuarioId)
      .eq("sucursal_id", sucursalId);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/asignaciones DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar la asignación."), { status: 500 });
  }
}
