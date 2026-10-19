import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Ajusta `productos.stock_actual` en `delta` (puede ser negativo).
 *
 * Se usa desde las rutas de lotes (crear / editar / eliminar) para mantener el
 * invariante que pidió el cliente: el stock total del producto representa SIEMPRE
 * la suma de las cantidades de sus lotes activos.
 *
 *   - Crear lote  -> delta = +cantidad
 *   - Editar lote -> delta = (contribución nueva) − (contribución vieja),
 *                    donde contribución = activo ? cantidad : 0
 *   - Eliminar    -> delta = −(contribución vieja)  (el lote pasa a activo=false)
 *
 * Read-modify-write (mismo patrón que el resto del módulo de inventario, sin RPC).
 * Best-effort: si falla la lectura/escritura no se propaga, para no romper la
 * operación de lote que la disparó; se loguea.
 */
export async function ajustarStockProducto(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
  delta: number
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  try {
    const q = await sb
      .from("productos")
      .select("stock_actual")
      .eq("empresa_id", empresaId)
      .eq("id", productoId)
      .maybeSingle();
    if (q.error || !q.data) return;
    const actual = Number((q.data as { stock_actual: number | string }).stock_actual) || 0;
    const nuevo = actual + delta;
    await sb
      .from("productos")
      .update({ stock_actual: nuevo })
      .eq("empresa_id", empresaId)
      .eq("id", productoId);
  } catch (e) {
    console.warn(
      "[lote-stock-sync] no se pudo ajustar stock_actual",
      productoId,
      delta,
      e instanceof Error ? e.message : e
    );
  }
}

/** Contribución de un lote al stock total: su cantidad si está activo, 0 si no. */
export function contribucionLote(cantidad: number, activo: boolean): number {
  return activo ? cantidad : 0;
}
