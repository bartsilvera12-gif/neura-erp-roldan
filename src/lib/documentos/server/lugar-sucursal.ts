import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Dirección, ciudad y departamento de una sucursal, para los renglones de
 * «punto de partida / llegada» de la nota de remisión.
 *
 * La dirección sale de Configuración → Sucursales (script 91). La ciudad y el
 * departamento no se cargan en ningún lado: se deducen del nombre (Carapeguá
 * está en Paraguarí; Casa Central, en San Antonio, Central). Si el nombre no
 * dice nada conocido, quedan en blanco para completar a mano.
 */
export async function lugarDeSucursal(
  sb: AppSupabaseClient,
  sucursalId: string | null | undefined
): Promise<{ nombre: string | null; direccion: string | null; ciudad: string | null; departamento: string | null }> {
  let nombre: string | null = null;
  let direccion: string | null = null;
  if (sucursalId) {
    const r = await sb.from("sucursales").select("*").eq("id", sucursalId).maybeSingle();
    const d = (r.data ?? {}) as { nombre?: string | null; direccion?: string | null };
    nombre = d.nombre ?? null;
    direccion = (d.direccion ?? "").trim() || null;
  }
  const n = String(nombre ?? "").toLowerCase();
  if (/carapegu/.test(n)) return { nombre, direccion, ciudad: "Carapeguá", departamento: "Paraguarí" };
  if (/jijoca/.test(n)) return { nombre, direccion, ciudad: null, departamento: null };
  if (!n || /central|casa/.test(n)) {
    return {
      nombre,
      // La de Casa Central, como figura en el formulario de la nota de remisión.
      direccion: direccion ?? "Avda. Acceso Sur 9581 c/ Pai Américo Ferreira",
      ciudad: "San Antonio",
      departamento: "Central",
    };
  }
  return { nombre, direccion, ciudad: null, departamento: null };
}

/** Fecha de hoy (Paraguay) en dd/mm/aaaa. */
export function hoyPyCorta(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const py = new Date(d.getTime() - 3 * 3600_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`;
}
