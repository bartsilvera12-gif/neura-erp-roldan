import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede, type RrhhAccion } from "@/lib/rrhh/permisos";

const ACCIONES: RrhhAccion[] = [
  "empleados.ver","empleados.editar","empleados.ver.propio",
  "salarios.ver","salarios.editar",
  "cursos.gestionar","vacaciones.gestionar","vacaciones.solicitar.propio",
  "marcaciones.gestionar","compras.solicitar",
];

/** GET /api/rrhh/me/permisos — devuelve rol + mapa de permisos del usuario actual (para UI). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const perms = await leerPermisosDeUsuario(
      ctx.supabase,
      ctx.auth.usuarioCatalogId ?? null,
      ctx.auth.user?.email ?? null
    );
    const flags = Object.fromEntries(ACCIONES.map((a) => [a, puede(perms, a)]));
    return NextResponse.json(successResponse({ rol: perms.rol, rol_rrhh: perms.rol_rrhh, permisos: flags }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
