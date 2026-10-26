import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Tope de descuento por usuario (punto 2.3).
 *
 * POR QUÉ SE VALIDA EN EL SERVIDOR
 *   En Caja el descuento es un campo más: esconderlo o limitarlo en pantalla no
 *   impide mandar la venta con otro precio. El tope solo es un tope si la venta
 *   se rechaza al guardarse.
 *
 * NULL ES "SIN TOPE", NO "CERO"
 *   El administrador no tiene techo: no tiene sentido que el sistema se lo
 *   ponga a quien decide los precios. Cero, en cambio, es un valor real y
 *   distinto: el cajero que cobra lo que dice la lista y nada más.
 */

/** Margen de tolerancia, en puntos porcentuales. */
const TOLERANCIA_PCT = 0.05;

/**
 * Tope del usuario, o `null` si no tiene.
 *
 * Nunca lanza. Si la columna todavía no existe (script 21 sin correr) o el
 * usuario no está en el catálogo, devuelve null: sin el dato, el sistema se
 * comporta como antes en vez de bloquear todas las ventas.
 */
export async function descuentoMaximoDe(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioCatalogId: string | null | undefined
): Promise<number | null> {
  if (!usuarioCatalogId) return null;
  try {
    const r = await supabase
      .from("usuarios")
      .select("descuento_maximo_pct")
      .eq("empresa_id", empresaId)
      .eq("id", usuarioCatalogId)
      .maybeSingle();
    if (r.error) {
      if (!/descuento_maximo_pct/.test(r.error.message ?? "")) {
        console.error("[descuento-maximo]", r.error.message);
      }
      return null;
    }
    const v = (r.data as { descuento_maximo_pct?: number | null } | null)?.descuento_maximo_pct;
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    console.error("[descuento-maximo]", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Descuento aplicado en una línea, en porcentaje sobre el precio de lista. */
export function descuentoPctDeLinea(
  precioOriginal: number | null | undefined,
  precioFinal: number | null | undefined
): number {
  const base = Number(precioOriginal) || 0;
  const final = Number(precioFinal) || 0;
  // Sin precio de lista no hay descuento que medir: el precio final ES el
  // precio. Es el caso de una venta cargada con un precio escrito a mano.
  if (base <= 0) return 0;
  const pct = (1 - final / base) * 100;
  return pct > 0 ? pct : 0;
}

export interface LineaConDescuento {
  producto_nombre?: string | null;
  precio_venta_original?: number | null;
  precio_venta?: number | null;
}

/**
 * Revisa que ninguna línea pase el tope. Devuelve el mensaje de error, o
 * `null` si está todo bien.
 *
 * La tolerancia de 0,05 puntos existe porque el precio se guarda redondeado a
 * guaraníes: un tope del 10% sobre un precio de 13.333 da 11.999,7, que
 * redondeado es 12.000 y mide 10,0002%. Rechazar eso sería rechazar
 * exactamente el descuento permitido.
 */
export function validarTopeDescuento(
  lineas: LineaConDescuento[],
  tope: number | null
): string | null {
  if (tope == null) return null;

  for (const l of lineas) {
    const pct = descuentoPctDeLinea(l.precio_venta_original, l.precio_venta);
    if (pct > tope + TOLERANCIA_PCT) {
      const nombre = l.producto_nombre ? `"${l.producto_nombre}"` : "una línea";
      return tope === 0
        ? `Tu usuario no tiene permitido aplicar descuentos, y ${nombre} tiene ${pct.toFixed(1)}% menos que el precio de lista.`
        : `El descuento de ${nombre} es ${pct.toFixed(1)}% y tu tope es ${tope}%. Pedile a un administrador que lo autorice.`;
    }
  }
  return null;
}
