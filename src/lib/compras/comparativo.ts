/**
 * Comparativo de cotizaciones entre proveedores.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Agregar comparativo de cotizaciones entre proveedores."
 *
 * ── LA TRAMPA DE ESTE INFORME ──────────────────────────────────────────────
 *   Lo obvio es sumar lo que cotizó cada proveedor y señalar al más barato.
 *   Está mal, y de una forma que no se ve: un proveedor que cotizó 2 de los 10
 *   artículos SIEMPRE va a tener el total más bajo.
 *
 *   Por eso acá el total nunca va solo: va con cuántos artículos cubre. Y el
 *   "más barato" se decide sobre los artículos que cotizaron TODOS, que es la
 *   única comparación que significa algo.
 *
 * ── Y LA OTRA: EL MÁS BARATO POR ARTÍCULO NO ES UN PROVEEDOR ───────────────
 *   Comprarle a cada uno lo suyo da el mínimo teórico, pero son cuatro
 *   pedidos, cuatro fletes y cuatro cobranzas. El informe muestra las dos
 *   cosas: lo que cuesta comprarle todo a uno, y lo que costaría repartiendo.
 *   La diferencia entre las dos es el dato que decide.
 */

export interface ItemCotizado {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

export interface PrecioCotizado {
  item_id: string;
  proveedor_id: string;
  /** Precio unitario. 0 o ausente = no lo cotizó. */
  precio_unitario: number;
  plazo_dias?: number | null;
}

export interface ProveedorCotiza {
  id: string;
  nombre: string;
}

const n = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/** Precio de un proveedor para un ítem, o null si no lo cotizó. */
export function precioDe(
  precios: PrecioCotizado[],
  itemId: string,
  proveedorId: string
): number | null {
  const p = precios.find((x) => x.item_id === itemId && x.proveedor_id === proveedorId);
  if (!p) return null;
  const v = n(p.precio_unitario);
  // Un cero es "no cotizó", no "es gratis". Nadie regala mercadería, y si lo
  // tomáramos como precio ganaría siempre.
  return v > 0 ? v : null;
}

export interface FilaComparativo {
  item: ItemCotizado;
  /** Precio por proveedor. null = no lo cotizó. */
  precios: Record<string, number | null>;
  /** Subtotal por proveedor: precio × cantidad. */
  subtotales: Record<string, number | null>;
  /** Proveedores que empataron en el precio más bajo. */
  mejores: string[];
  mejor_precio: number | null;
  /** Cuánto más caro es el más caro respecto del más barato, en %. */
  dispersion_pct: number | null;
}

export function armarFilas(
  items: ItemCotizado[],
  proveedores: ProveedorCotiza[],
  precios: PrecioCotizado[]
): FilaComparativo[] {
  return items.map((item) => {
    const porProv: Record<string, number | null> = {};
    const sub: Record<string, number | null> = {};
    for (const pr of proveedores) {
      const v = precioDe(precios, item.id, pr.id);
      porProv[pr.id] = v;
      sub[pr.id] = v == null ? null : v * n(item.cantidad);
    }
    const validos = Object.values(porProv).filter((v): v is number => v != null);
    const mejor = validos.length > 0 ? Math.min(...validos) : null;
    const peor = validos.length > 0 ? Math.max(...validos) : null;
    return {
      item,
      precios: porProv,
      subtotales: sub,
      mejores: mejor == null ? [] : proveedores.filter((p) => porProv[p.id] === mejor).map((p) => p.id),
      mejor_precio: mejor,
      dispersion_pct: mejor != null && peor != null && mejor > 0 ? ((peor - mejor) / mejor) * 100 : null,
    };
  });
}

export interface ResumenProveedor {
  proveedor_id: string;
  nombre: string;
  /** Cuántos ítems cotizó, de todos los pedidos. */
  cotizados: number;
  /** Suma de lo que cotizó. OJO: no comparable si no cotizó todo. */
  total: number;
  /** Cuántos ítems tiene al mejor precio. */
  gana_en: number;
  /** true si cotizó TODOS los ítems pedidos. */
  completo: boolean;
  /** Total sobre los ítems que cotizaron todos. Comparable entre proveedores. */
  total_comparable: number | null;
}

export function resumirProveedores(
  items: ItemCotizado[],
  proveedores: ProveedorCotiza[],
  filas: FilaComparativo[]
): ResumenProveedor[] {
  // Los ítems que TODOS cotizaron: la única base justa para comparar totales.
  const comunes = filas.filter((f) => proveedores.every((p) => f.precios[p.id] != null));

  return proveedores.map((pr) => {
    let cotizados = 0, total = 0, gana = 0;
    for (const f of filas) {
      const sub = f.subtotales[pr.id];
      if (sub != null) { cotizados += 1; total += sub; }
      if (f.mejores.includes(pr.id)) gana += 1;
    }
    const comparable = comunes.length > 0
      ? comunes.reduce((s, f) => s + (f.subtotales[pr.id] ?? 0), 0)
      : null;
    return {
      proveedor_id: pr.id,
      nombre: pr.nombre,
      cotizados,
      total,
      gana_en: gana,
      completo: cotizados === items.length && items.length > 0,
      total_comparable: comparable,
    };
  });
}

export interface Veredicto {
  /** El más barato comprándole TODO a uno. null si ninguno cotizó todo. */
  mejor_completo: ResumenProveedor | null;
  /** Lo que costaría comprándole a cada uno lo suyo. */
  total_repartido: number | null;
  /** Cuánto se ahorra repartiendo contra comprarle todo al mejor. */
  ahorro_repartiendo: number | null;
  /** Ítems que nadie cotizó: hay que pedirlos aparte. */
  sin_cotizar: ItemCotizado[];
  /** Cuántos ítems cotizaron todos los proveedores. */
  items_comparables: number;
}

export function veredicto(
  items: ItemCotizado[],
  proveedores: ProveedorCotiza[],
  filas: FilaComparativo[],
  resumen: ResumenProveedor[]
): Veredicto {
  const completos = resumen.filter((r) => r.completo);
  const mejorCompleto = completos.length > 0
    ? completos.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  const conMejor = filas.filter((f) => f.mejor_precio != null);
  const totalRepartido = conMejor.length > 0
    ? conMejor.reduce((s, f) => s + (f.mejor_precio ?? 0) * n(f.item.cantidad), 0)
    : null;

  return {
    mejor_completo: mejorCompleto,
    total_repartido: totalRepartido,
    ahorro_repartiendo:
      mejorCompleto && totalRepartido != null ? mejorCompleto.total - totalRepartido : null,
    sin_cotizar: filas.filter((f) => f.mejor_precio == null).map((f) => f.item),
    items_comparables: filas.filter((f) => proveedores.every((p) => f.precios[p.id] != null)).length,
  };
}

/** Las líneas para armarle la orden de compra a un proveedor del comparativo. */
export function lineasParaProveedor(
  filas: FilaComparativo[],
  proveedorId: string
): Array<{ descripcion: string; cantidad: number; unidad: string; precio_unitario: number }> {
  return filas
    .filter((f) => f.precios[proveedorId] != null)
    .map((f) => ({
      descripcion: f.item.descripcion,
      cantidad: n(f.item.cantidad),
      unidad: f.item.unidad || "UNIDAD",
      precio_unitario: f.precios[proveedorId] ?? 0,
    }));
}
