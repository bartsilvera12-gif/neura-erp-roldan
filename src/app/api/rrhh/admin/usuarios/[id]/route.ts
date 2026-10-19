import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario } from "@/lib/rrhh/permisos";

const ROLES_RRHH = ["admin","gestor","rrhh","encargado_obra","empleado"] as const;

/**
 * PATCH /api/rrhh/admin/usuarios/[id]
 * Body: { rol_rrhh: "admin" | "gestor" | "rrhh" | "encargado_obra" | "empleado" | null }
 * Sólo admin puede modificar. No toca la columna legacy `rol` (super_admin, admin,
 * usuario) para no romper otras RLS.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  const admin = perms.rol === "super_admin" || perms.rol === "admin" || perms.rol_rrhh === "admin";
  if (!admin) return NextResponse.json(errorResponse("Sólo administradores pueden gestionar roles"), { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rolRrhhRaw = body.rol_rrhh;
  let rol_rrhh: string | null = null;
  if (rolRrhhRaw !== null && rolRrhhRaw !== undefined && rolRrhhRaw !== "") {
    const v = String(rolRrhhRaw);
    if (!ROLES_RRHH.includes(v as typeof ROLES_RRHH[number])) {
      return NextResponse.json(errorResponse("rol_rrhh inválido"), { status: 400 });
    }
    rol_rrhh = v;
  }

  const { error } = await ctx.supabase
    .from("usuarios")
    .update({ rol_rrhh })
    .eq("id", id)
    .eq("empresa_id", ctx.auth.empresa_id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ ok: true }));
}
