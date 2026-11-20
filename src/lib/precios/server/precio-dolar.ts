import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { cotizacionVentaUsd } from "@/lib/precios/server/precio-para-cliente";

/**
 * Los productos con precio en dólares se venden al dólar de HOY (pedido del
 * cliente, punto 21): si se compró con el dólar a 6.400 y hoy está a 6.500,
 * el precio en guaraníes sube. Los productos en guaraníes no cambian: a esos
 * solo los mueve la remarcación.
 *
 * Esto pisa `precio_venta` en las listas que lee la pantalla (inventario,
 * caja, presupuestos, buscador), con el dólar × la cotización de venta. El
 * guaraní guardado queda en `precio_venta_guardado` por si hace falta verlo.
 */
export async function conPrecioDelDolar<T extends Record<string, unknown>>(
  sb: AppSupabaseClient,
  empresaId: string,
  filas: T[],
  tc?: number | null
): Promise<T[]> {
  if (!filas.some((f) => Number(f.precio_usd) > 0)) return filas;
  const cot = tc !== undefined ? tc : await cotizacionVentaUsd(sb, empresaId).catch(() => null);
  if (!cot || !(cot > 0)) return filas;
  return filas.map((f) => {
    const usd = Number(f.precio_usd);
    if (!(usd > 0)) return f;
    return { ...f, precio_venta_guardado: f.precio_venta, precio_venta: Math.round(usd * cot) };
  });
}
