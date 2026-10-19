import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Arma la nota INTERNA (no fiscal) "Emitido por" para el pie del KUDE:
 * `{nombre} · Tel: {telefono} · {email}` con los datos del usuario que emitió
 * el documento. Se busca el usuario por `auth_user_id`; `fallbackNombre` es el
 * snapshot guardado en el documento (por si el usuario cambió o no se encuentra).
 * Best-effort: si algo falla, devuelve al menos el nombre o null.
 */
export async function formatEmitidoPorByAuthUserId(
  sb: AppSupabaseClient,
  empresaId: string,
  authUserId: string | null,
  fallbackNombre: string | null
): Promise<string | null> {
  let nombre: string | null = (fallbackNombre ?? "").trim() || null;
  let email: string | null = null;
  let telefono: string | null = null;
  if (authUserId) {
    try {
      const { data } = await sb
        .from("usuarios")
        .select("nombre, email, telefono")
        .eq("empresa_id", empresaId)
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      const u = data as { nombre?: string | null; email?: string | null; telefono?: string | null } | null;
      nombre = (u?.nombre ?? "").trim() || nombre;
      email = (u?.email ?? "").trim() || null;
      telefono = (u?.telefono ?? "").trim() || null;
    } catch {
      /* best-effort: se queda con el fallback */
    }
  }
  const parts = [nombre, telefono ? `Tel: ${telefono}` : "", email].filter(
    (x): x is string => !!x
  );
  return parts.length ? parts.join(" · ") : null;
}
