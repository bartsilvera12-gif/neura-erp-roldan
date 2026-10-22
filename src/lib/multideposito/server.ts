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
  }

  // No hay fila para (producto, ubicación).
  if (delta >= 0) {
    const ins = await supabase
      .from("inventario_stock_ubicacion")
      .insert({ empresa_id: empresaId, ubicacion_id: ubicacionId, producto_id: productoId, stock_actual: delta });
    return ins.error ? ins.error.message : null;
  }

  // Delta negativo sin fila. Puede ser una de dos cosas muy distintas:
  //
  //  a) El producto tiene stock global pero nunca se repartió por depósito
  //     (se cargó con stock inicial sin elegir depósito, o el alta es anterior
  //     al multidepósito). El saldo existe, solo que no está desglosado. Antes
  //     esto daba "Sin fila de stock y delta negativo" y la salida se rechazaba
  //     aunque el producto tuviera 250 unidades.
  //
  //  b) El producto sí está repartido, pero en OTRO depósito. Ahí la salida
  //     tiene que fallar: no se puede sacar de donde no hay.
  //
  // Se distinguen mirando si existe algún desglose para ese producto.
  const totalQ = await supabase
    .from("inventario_stock_ubicacion")
    .select("stock_actual")
    .eq("empresa_id", empresaId)
    .eq("producto_id", productoId);
  if (totalQ.error) return totalQ.error.message;

  const repartido = (totalQ.data ?? []).reduce(
    (a: number, r: { stock_actual?: number | string }) => a + (Number(r.stock_actual) || 0),
    0
  );
  if (repartido > 0) {
    return `El producto no tiene stock en este depósito (está en otro). Hacé primero una transferencia o elegí el depósito correcto.`;
  }

  // Caso (a): se inicializa el desglose con el stock global y se aplica el delta.
  const prodQ = await supabase
    .from("productos")
    .select("stock_actual")
    .eq("empresa_id", empresaId)
    .eq("id", productoId)
    .maybeSingle();
  if (prodQ.error) return prodQ.error.message;

  const global = Number((prodQ.data as { stock_actual?: number } | null)?.stock_actual) || 0;
  const inicial = global + delta;
  if (inicial < 0) {
    return `Stock insuficiente: hay ${global} y se intentan sacar ${Math.abs(delta)}.`;
  }
  const ins = await supabase
    .from("inventario_stock_ubicacion")
    .insert({ empresa_id: empresaId, ubicacion_id: ubicacionId, producto_id: productoId, stock_actual: inicial });
  return ins.error ? ins.error.message : null;
}
