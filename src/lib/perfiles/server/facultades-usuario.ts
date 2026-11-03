import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  facultadesDeNivel,
  soloFacultadesConocidas,
  type Facultad,
} from "@/lib/perfiles/facultades";
import { normalizeErpRolSlug } from "@/lib/usuarios/erp-rol-normalize";

/**
 * Qué puede hacer este usuario.
 *
 * ── EL ORDEN IMPORTA ──────────────────────────────────────────────────────
 *   1. Si tiene PERFIL asignado, manda el perfil. Punto.
 *   2. Si no tiene, manda su NIVEL, con las mismas facultades que el sistema
 *      le daba antes de que existieran los perfiles.
 *
 *   El paso 2 no es una cortesía: sin él, correr el script de perfiles dejaría
 *   a todo el mundo sin poder anular, autorizar ni ver un costo hasta que
 *   alguien configure usuario por usuario. Una migración que apaga el negocio
 *   hasta que se la configure es una migración que no se corre.
 *
 * ── POR QUÉ EL PERFIL NO SE SUMA AL NIVEL ─────────────────────────────────
 *   Si se sumaran, sacarle una facultad a un perfil no se la sacaría a nadie
 *   que además fuera supervisor, y la pantalla de configuración estaría
 *   mintiendo. El perfil reemplaza: es la respuesta completa.
 *
 * Nunca lanza. Si la consulta falla —o si el script 63 todavía no se corrió—
 * se cae al nivel, que es el comportamiento de siempre.
 */
export async function facultadesDeUsuario(
  sb: AppSupabaseClient,
  auth: { empresa_id: string; rol?: string | null; usuarioCatalogId?: string | null }
): Promise<Set<Facultad>> {
  const porNivel = new Set(facultadesDeNivel(nivelDeRol(auth.rol)));

  const usuarioId = auth.usuarioCatalogId ?? null;
  if (!usuarioId) return porNivel;

  try {
    const uQ = await sb
      .from("usuarios")
      .select("perfil_id")
      .eq("empresa_id", auth.empresa_id)
      .eq("id", usuarioId)
      .maybeSingle();
    if (uQ.error) return porNivel;

    const perfilId = (uQ.data as { perfil_id?: string | null } | null)?.perfil_id ?? null;
    if (!perfilId) return porNivel;

    const fQ = await sb
      .from("perfil_facultades")
      .select("facultad")
      .eq("perfil_id", perfilId);
    if (fQ.error) return porNivel;

    // Un perfil SIN facultades es una decisión válida —el cajero no tiene
    // ninguna— así que un resultado vacío se respeta en vez de caer al nivel.
    const lista = soloFacultadesConocidas(
      ((fQ.data ?? []) as Array<{ facultad: string }>).map((r) => r.facultad)
    );
    return new Set(lista);
  } catch {
    return porNivel;
  }
}

/** Atajo para los guards: `await tieneFacultad(sb, auth, "anular_venta")`. */
export async function tieneFacultad(
  sb: AppSupabaseClient,
  auth: { empresa_id: string; rol?: string | null; usuarioCatalogId?: string | null },
  facultad: Facultad
): Promise<boolean> {
  return (await facultadesDeUsuario(sb, auth)).has(facultad);
}

function nivelDeRol(rol: string | null | undefined): "administrador" | "supervisor" | "usuario" {
  const r = normalizeErpRolSlug(rol);
  if (r === "administrador" || r === "admin" || r === "super_admin") return "administrador";
  if (r === "supervisor") return "supervisor";
  return "usuario";
}
