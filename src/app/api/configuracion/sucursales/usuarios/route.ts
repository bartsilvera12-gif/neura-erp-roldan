import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

function esAdmin(rol: string | null | undefined): boolean {
  const r = (rol ?? "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

/** GET /api/configuracion/sucursales/usuarios — usuarios activos de la empresa (para la matriz). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const sr = createServiceRoleClient();
    const { data, error } = await sr
      .from("usuarios")
      .select("id, nombre, email, rol, activo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("activo", true)
      .order("nombre");
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ usuarios: data ?? [] }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales/usuarios GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los usuarios."), { status: 500 });
  }
}
