import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * La obra y el anticipo de un presupuesto (script 89).
 *
 * Van aparte del alta y la edición a propósito: si el script 89 todavía no
 * se corrió, el presupuesto se guarda igual y solo se pierden estos datos,
 * en vez de rechazarse entero por una columna que no existe.
 */

export const AVISO_89 = "Falta correr el script 89: todavía no hay dónde guardar las obras.";

export function faltaScript89(msg: string | null | undefined): boolean {
  return /obra|anticipo_pct|reservado_hasta/.test(String(msg ?? "")) &&
    /does not exist|42703|42P01|schema cache|relation/i.test(String(msg ?? ""));
}

export type Extras89 = {
  obra_id: string | null;
  obra_nombre: string | null;
  obra_direccion: string | null;
  anticipo_pct: number | null;
};

/** Lee la obra y el anticipo. Sin el script 89, todo en null. */
export async function leerExtras89(sb: AppSupabaseClient, empresaId: string, presupuestoId: string): Promise<Extras89> {
  const vacio: Extras89 = { obra_id: null, obra_nombre: null, obra_direccion: null, anticipo_pct: null };
  try {
    const r = await sb
      .from("presupuestos")
      .select("obra_id, obra_nombre, obra_direccion, anticipo_pct")
      .eq("empresa_id", empresaId)
      .eq("id", presupuestoId)
      .maybeSingle();
    if (r.error || !r.data) return vacio;
    const d = r.data as Record<string, unknown>;
    const pct = d.anticipo_pct == null ? null : Number(d.anticipo_pct);
    return {
      obra_id: d.obra_id ? String(d.obra_id) : null,
      obra_nombre: d.obra_nombre ? String(d.obra_nombre) : null,
      obra_direccion: d.obra_direccion ? String(d.obra_direccion) : null,
      anticipo_pct: pct != null && Number.isFinite(pct) ? pct : null,
    };
  } catch {
    return vacio;
  }
}

/**
 * Guarda lo que venga en el cuerpo. Solo toca las claves presentes: un cambio
 * de estado no manda la obra y no tiene por qué borrarla.
 *
 * La obra se copia de la tabla `obras` (nombre y dirección del día): el papel
 * no tiene que cambiar si después alguien edita la obra.
 *
 * Devuelve un aviso si no se pudo guardar, o null.
 */
export async function guardarExtras89(
  sb: AppSupabaseClient,
  empresaId: string,
  presupuestoId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const patch: Record<string, unknown> = {};

  if ("obra_id" in body) {
    const obraId = typeof body.obra_id === "string" ? body.obra_id.trim() : "";
    if (!obraId) {
      Object.assign(patch, { obra_id: null, obra_nombre: null, obra_direccion: null });
    } else {
      const o = await sb
        .from("obras")
        .select("id, nombre, direccion, ciudad")
        .eq("empresa_id", empresaId)
        .eq("id", obraId)
        .maybeSingle();
      if (o.error) return faltaScript89(o.error.message) ? AVISO_89 : o.error.message;
      if (!o.data) return "La obra elegida ya no existe.";
      const d = o.data as Record<string, unknown>;
      const dir = [d.direccion, d.ciudad].map((x) => (x == null ? "" : String(x).trim())).filter(Boolean).join(", ");
      Object.assign(patch, { obra_id: obraId, obra_nombre: String(d.nombre ?? ""), obra_direccion: dir || null });
    }
  }

  if ("anticipo_pct" in body) {
    const v = body.anticipo_pct;
    if (v === null || v === "" || v === undefined) {
      patch.anticipo_pct = null;
    } else {
      const pct = Number(v);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "El anticipo tiene que ser un porcentaje entre 0 y 100.";
      patch.anticipo_pct = Math.round(pct * 100) / 100;
    }
  }

  if (Object.keys(patch).length === 0) return null;
  const up = await sb.from("presupuestos").update(patch).eq("empresa_id", empresaId).eq("id", presupuestoId);
  if (up.error) return faltaScript89(up.error.message) ? AVISO_89 : up.error.message;
  return null;
}
