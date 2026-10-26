import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario } from "@/lib/rrhh/permisos";

const ROLES_RRHH = ["admin","gestor","rrhh","encargado_obra","empleado"] as const;

/**
 * PATCH /api/rrhh/admin/usuarios/[id]
 * Body: { rol_rrhh?: "admin" | "gestor" | "rrhh" | "encargado_obra" | "empleado" | null,
 *         descuento_maximo_pct?: number | null }
 * Sólo admin puede modificar. No toca la columna legacy `rol` (super_admin, admin,
 * usuario) para no romper otras RLS.
 *
 * `descuento_maximo_pct` (punto 2.3) es el tope de descuento del usuario en
 * Caja. null = sin tope; 0 = no puede descontar nada, que es distinto.
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

  // Se arma el patch con lo que vino: mandar solo el tope no tiene que pisar
  // el rol, ni al revés.
  const patch: Record<string, unknown> = {};
  if ("rol_rrhh" in body) patch.rol_rrhh = rol_rrhh;
  if ("descuento_maximo_pct" in body) {
    const raw = body.descuento_maximo_pct;
    if (raw === null || raw === "") {
      patch.descuento_maximo_pct = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json(
          errorResponse("El descuento máximo tiene que ser un número entre 0 y 100, o vacío para sin tope."),
          { status: 400 }
        );
      }
      patch.descuento_maximo_pct = n;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(errorResponse("No hay nada para cambiar."), { status: 400 });
  }

  const { error } = await ctx.supabase
    .from("usuarios")
    .update(patch)
    .eq("id", id)
    .eq("empresa_id", ctx.auth.empresa_id);
  if (error) {
    if (/descuento_maximo_pct/.test(error.message ?? "")) {
      return NextResponse.json(
        errorResponse("Falta correr 21_descuento_maximo_usuario.sql en la base."),
        { status: 500 }
      );
    }
    return NextResponse.json(errorResponse(error.message), { status: 400 });
  }
  return NextResponse.json(successResponse({ ok: true }));
}
