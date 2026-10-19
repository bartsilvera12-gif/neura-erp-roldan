import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario } from "@/lib/rrhh/permisos";

/**
 * GET /api/rrhh/admin/usuarios
 * Lista los usuarios del tenant con su rol legacy + rol_rrhh. Sólo accesible
 * para admin (legacy super_admin/admin o rol_rrhh=admin). Se usa desde la
 * pantalla /configuracion/usuarios para gestionar permisos.
 */

async function esAdmin(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return { err: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) } as const;
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  const admin = perms.rol === "super_admin" || perms.rol === "admin" || perms.rol_rrhh === "admin";
  if (!admin) return { err: NextResponse.json(errorResponse("Sólo administradores pueden gestionar roles"), { status: 403 }) } as const;
  return { ctx } as const;
}

export async function GET(request: NextRequest) {
  const g = await esAdmin(request);
  if ("err" in g) return g.err;

  const { data, error } = await g.ctx.supabase
    .from("usuarios")
    .select("id, nombre, email, rol, rol_rrhh, estado, auth_user_id")
    .eq("empresa_id", g.ctx.auth.empresa_id)
    .order("nombre", { ascending: true })
    .order("email", { ascending: true });
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ usuarios: data ?? [] }));
}
