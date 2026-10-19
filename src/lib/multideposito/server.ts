/**
 * Helpers server-side para el modelo multi-depósito.
 * Se usan desde APIs (rutas de clasificación, ventas, anulaciones, etc.).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resuelve el ID de la ubicación por código (CENTRAL, ABASTO-N, …).
 * Cachea en memoria por (empresa_id, codigo) durante la vida del proceso.
 */
const cache = new Map<string, string>();

export async function getUbicacionIdByCodigo(
  supabase: SupabaseClient,
  empresaId: string,
  codigo: string
): Promise<string | null> {
  const key = `${empresaId}::${codigo}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const q = await supabase
    .from("inventario_ubicaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("codigo", codigo)
    .eq("activo", true)
    .maybeSingle();
  if (q.error || !q.data) return null;
  const id = (q.data as { id: string }).id;
  cache.set(key, id);
  return id;
}

/**
 * Ajusta el stock por ubicación (INSERT o UPDATE del registro (empresa, producto, ubicacion)).
 * `delta` positivo suma, negativo resta. No permite quedar en negativo — devuelve string con error.
 */
export async function ajustarStockUbicacion(
  supabase: SupabaseClient,
  empresaId: string,
  ubicacionId: string,
  productoId: string,
  delta: number
): Promise<string | null> {
  const q = await supabase
    .from("inventario_stock_ubicacion")
    .select("id, stock_actual")
    .eq("empresa_id", empresaId)
    .eq("ubicacion_id", ubicacionId)
    .eq("producto_id", productoId)
    .maybeSingle();
  if (q.error) return q.error.message;
  if (q.data) {
    const nuevo = Number((q.data as { stock_actual: number }).stock_actual) + delta;
    if (nuevo < 0) return `Stock final negativo (${nuevo}) para producto ${productoId} en ubicación ${ubicacionId}`;
    const up = await supabase
      .from("inventario_stock_ubicacion")
      .update({ stock_actual: nuevo, updated_at: new Date().toISOString() })
      .eq("id", (q.data as { id: string }).id);
    return up.error ? up.error.message : null;
  } else {
    if (delta < 0) return `Sin fila de stock y delta negativo para producto ${productoId} en ubicación ${ubicacionId}`;
    const ins = await supabase
      .from("inventario_stock_ubicacion")
      .insert({ empresa_id: empresaId, ubicacion_id: ubicacionId, producto_id: productoId, stock_actual: delta });
    return ins.error ? ins.error.message : null;
  }
}
