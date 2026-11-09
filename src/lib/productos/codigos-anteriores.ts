import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { splitTokens } from "@/lib/productos/token-search";

/**
 * Buscar un producto por el código que tenía antes.
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 *   En Carapeguá el arco de sierra fue FASP durante años. Al unificarlo con
 *   Casa Central pasó a FARSP. Quien lo pide por teléfono dice FASP, quien lo
 *   busca en el sistema escribe FASP, y no encontraba nada.
 *
 *   El código viejo no está mal: es el que está en los papeles, en las
 *   estanterías y en la cabeza de la gente. Lo único que cambió es cuál usa el
 *   sistema de acá en adelante.
 *
 * ── CÓMO SE BUSCA ──────────────────────────────────────────────────────────
 *   Por código ENTERO, no por pedacitos. El nombre se busca por partes porque
 *   nadie recuerda la descripción exacta; un código, en cambio, se sabe o no
 *   se sabe. Buscar "CT8" por adentro de los códigos viejos traería medio
 *   catálogo y el que escribió el código completo perdería su resultado entre
 *   cincuenta que no pidió.
 */

export interface CodigoAnterior {
  producto_id: string;
  codigo: string;
  vigente_hasta: string | null;
}

/**
 * Los productos cuyo código viejo es exactamente alguno de los tokens.
 *
 * Devuelve un mapa token → ids, para que la búsqueda por varias palabras siga
 * pidiendo que TODAS aparezcan: un token puede calzar por el nombre y el otro
 * por un código viejo.
 *
 * Si la tabla todavía no existe —falta correr el script 82— devuelve un mapa
 * vacío y la búsqueda sigue funcionando como siempre. Que falte un script no
 * puede dejar sin buscador a toda la pantalla.
 */
export async function idsPorCodigoAnterior(
  supabase: AppSupabaseClient,
  empresaId: string,
  q: string
): Promise<Map<string, string[]>> {
  const tokens = splitTokens(q)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const mapa = new Map<string, string[]>();
  if (tokens.length === 0) return mapa;

  try {
    const { data, error } = await supabase
      .from("producto_codigos_anteriores")
      .select("producto_id, codigo")
      .eq("empresa_id", empresaId)
      .in("codigo", Array.from(new Set(tokens.flatMap((t) => [t, t.toUpperCase(), t.toLowerCase()]))))
      .limit(500);
    if (error) return mapa;
    for (const f of (data ?? []) as Array<{ producto_id: string; codigo: string }>) {
      const cod = String(f.codigo ?? "").trim().toUpperCase();
      for (const t of tokens) {
        if (t.toUpperCase() !== cod) continue;
        const ya = mapa.get(t) ?? [];
        if (!ya.includes(f.producto_id)) ya.push(f.producto_id);
        mapa.set(t, ya);
      }
    }
  } catch {
    /* sin la tabla, se busca como siempre */
  }
  return mapa;
}

/** Los códigos viejos de un conjunto de productos, para mostrarlos en la ficha. */
export async function codigosAnterioresDe(
  supabase: AppSupabaseClient,
  empresaId: string,
  productoIds: string[]
): Promise<Map<string, CodigoAnterior[]>> {
  const mapa = new Map<string, CodigoAnterior[]>();
  if (productoIds.length === 0) return mapa;
  try {
    const { data, error } = await supabase
      .from("producto_codigos_anteriores")
      .select("producto_id, codigo, vigente_hasta")
      .eq("empresa_id", empresaId)
      .in("producto_id", productoIds.slice(0, 1000));
    if (error) return mapa;
    for (const f of (data ?? []) as CodigoAnterior[]) {
      const ya = mapa.get(f.producto_id) ?? [];
      ya.push(f);
      mapa.set(f.producto_id, ya);
    }
  } catch {
    /* sin la tabla, no se muestra nada */
  }
  return mapa;
}
