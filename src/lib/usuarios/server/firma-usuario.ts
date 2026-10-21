import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";

/** Quién hizo una operación, tal como se guarda en las tablas de auditoría. */
export type FirmaUsuario = {
  /** PK de `usuarios` del tenant, o null si la sesión no tiene fila propia. */
  id: string | null;
  /** Nombre a mostrar. Nunca null: si no hay nombre cargado, cae al correo. */
  nombre: string;
};

/**
 * Resuelve el nombre con el que firmar un movimiento, cobro o ajuste.
 *
 * El QA marcó que la columna "Usuario" de los movimientos de inventario
 * mostraba tres cosas distintas: "Administrador", "Sin registro" y el correo.
 * Eso pasaba porque cada endpoint resolvía el usuario a su manera (o no lo
 * guardaba). Acá queda un solo criterio: nombre de la fila `usuarios`, y si no
 * lo hay, el correo de la sesión. Nunca queda vacío.
 */
export async function firmaUsuario(
  supabase: SupabaseClient,
  auth: UsuarioConEmpresa
): Promise<FirmaUsuario> {
  const email = String(auth.user?.email ?? "").trim();
  const porDefecto: FirmaUsuario = { id: auth.usuarioCatalogId ?? null, nombre: email || "—" };

  try {
    const q = auth.usuarioCatalogId
      ? supabase.from("usuarios").select("id, nombre, email").eq("id", auth.usuarioCatalogId)
      : supabase.from("usuarios").select("id, nombre, email").eq("auth_user_id", auth.user?.id ?? "");
    const { data } = await q.eq("empresa_id", auth.empresa_id).limit(1);
    const fila = (data ?? [])[0] as { id?: string; nombre?: string | null; email?: string | null } | undefined;
    if (!fila) return porDefecto;
    const nombre = String(fila.nombre ?? "").trim() || String(fila.email ?? "").trim() || email;
    return { id: fila.id ?? porDefecto.id, nombre: nombre || "—" };
  } catch {
    // La firma nunca debe tumbar la operación que la usa.
    return porDefecto;
  }
}
