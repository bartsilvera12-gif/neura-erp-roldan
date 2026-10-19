/**
 * Permisos RRHH — gate para endpoints y UI.
 * Espejo TS de roldanerp.rrhh_puede(). Adaptado a Paraguay.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type RrhhAccion =
  | "empleados.ver"
  | "empleados.editar"
  | "empleados.ver.propio"
  | "salarios.ver"
  | "salarios.editar"
  | "cursos.gestionar"
  | "vacaciones.gestionar"
  | "vacaciones.solicitar.propio"
  | "marcaciones.gestionar"
  | "compras.solicitar";

export type RolRrhh = "admin" | "gestor" | "rrhh" | "encargado_obra" | "empleado";
export type RolLegacy = "super_admin" | "admin" | "usuario" | string;

export type UsuarioPermisos = {
  rol: RolLegacy | null;
  rol_rrhh: RolRrhh | null;
};

const MATRIZ_RRHH: Record<RolRrhh, RrhhAccion[]> = {
  admin: [
    "empleados.ver","empleados.editar","empleados.ver.propio",
    "salarios.ver","salarios.editar",
    "cursos.gestionar","vacaciones.gestionar","vacaciones.solicitar.propio",
    "marcaciones.gestionar","compras.solicitar",
  ],
  gestor: ["empleados.ver","salarios.ver","salarios.editar","compras.solicitar"],
  rrhh: ["empleados.ver","empleados.editar","cursos.gestionar","vacaciones.gestionar","marcaciones.gestionar"],
  encargado_obra: ["empleados.ver","marcaciones.gestionar","compras.solicitar"],
  empleado: ["empleados.ver.propio","vacaciones.solicitar.propio"],
};

const FALLBACK_ROL_USUARIO: RrhhAccion[] = [
  "empleados.ver","empleados.editar",
  "cursos.gestionar","vacaciones.gestionar","marcaciones.gestionar",
];

function esRolLegacyAdmin(rol: string | null): boolean {
  if (!rol) return false;
  const r = rol.trim().toLowerCase();
  return r === "super_admin" || r === "superadmin" || r === "super admin"
      || r === "admin" || r === "administrador";
}

export function puede(u: UsuarioPermisos, accion: RrhhAccion): boolean {
  if (!u.rol) return false;
  if (esRolLegacyAdmin(u.rol)) return true;
  if (u.rol_rrhh) return (MATRIZ_RRHH[u.rol_rrhh] ?? []).includes(accion);
  return FALLBACK_ROL_USUARIO.includes(accion);
}

/** Lee los roles del usuario autenticado (roldanerp.usuarios). */
export async function leerPermisosDeUsuario(
  supabase: AppSupabaseClient,
  usuarioCatalogId: string | null,
  email: string | null,
): Promise<UsuarioPermisos> {
  if (usuarioCatalogId) {
    const { data } = await supabase
      .from("usuarios")
      .select("rol, rol_rrhh")
      .eq("id", usuarioCatalogId)
      .maybeSingle();
    if (data) return { rol: (data as { rol: string | null }).rol ?? null, rol_rrhh: (data as { rol_rrhh: RolRrhh | null }).rol_rrhh ?? null };
  }
  if (email) {
    const { data } = await supabase
      .from("usuarios")
      .select("rol, rol_rrhh")
      .ilike("email", email)
      .maybeSingle();
    if (data) return { rol: (data as { rol: string | null }).rol ?? null, rol_rrhh: (data as { rol_rrhh: RolRrhh | null }).rol_rrhh ?? null };
  }
  return { rol: null, rol_rrhh: null };
}
