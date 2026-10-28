import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { precioListaGs } from "@/lib/precios/ficha";

/**
 * De dónde salió el precio que se le va a cobrar al cliente.
 *  - `excepcion_producto`: precio negociado cargado en la ficha del producto
 *    para ese rubro. Es la excepción y gana sobre todo lo demás.
 *  - `ajuste_rubro`: el porcentaje del rubro aplicado sobre el precio de lista.
 *    Es la regla general.
 *  - `lista`: el cliente no tiene rubro, o el rubro no tiene porcentaje.
 */
export type FuentePrecio = "excepcion_producto" | "ajuste_rubro" | "lista";

export type PrecioParaCliente = {
  precio: number;
  precio_lista: number;
  fuente: FuentePrecio;
  categoria_id: string | null;
  categoria_nombre: string | null;
  ajuste_pct: number | null;
  /** false cuando todavía no se corrió el script 39: el rubro no tiene porcentaje. */
  ajuste_disponible: boolean;
};

type Sb = AppSupabaseClient;

/** El error de PostgREST cuando falta `categorias_cliente.ajuste_pct` (script 39). */
function faltaScript39(msg: string): boolean {
  return /column .* does not exist|42703/i.test(msg) && /ajuste_pct/.test(msg);
}

/**
 * La cotización de venta del dólar que rige hoy. Se lee una sola vez por
 * pedido y se reparte entre todos los productos: sin ella, un producto con
 * precio en dólares cae a su último precio en guaraníes conocido.
 */
export async function cotizacionVentaUsd(sb: Sb, empresaId: string): Promise<number | null> {
  const r = await sb
    .from("tipos_cambio")
    .select("venta")
    .eq("empresa_id", empresaId)
    .eq("moneda", "USD")
    .lte("vigente_desde", new Date().toISOString())
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Sin tabla de cotizaciones el sistema sigue vendiendo en guaraníes.
  if (r.error) return null;
  const v = Number((r.data as { venta?: number | string } | null)?.venta);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** El rubro del cliente, con su porcentaje si el script 39 ya corrió. */
export async function rubroDelCliente(
  sb: Sb,
  empresaId: string,
  clienteId: string | null | undefined
): Promise<{ id: string; nombre: string | null; ajuste_pct: number | null; disponible: boolean } | null> {
  if (!clienteId) return null;

  const cQ = await sb
    .from("clientes")
    .select("categoria_cliente_id")
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .maybeSingle();
  if (cQ.error) throw new Error(cQ.error.message);
  const catId = (cQ.data as { categoria_cliente_id?: string | null } | null)?.categoria_cliente_id ?? null;
  if (!catId) return null;

  const leer = (cols: string) =>
    sb.from("categorias_cliente").select(cols).eq("id", catId).maybeSingle();

  let disponible = true;
  let r = await leer("nombre, ajuste_pct");
  if (r.error && faltaScript39(r.error.message ?? "")) {
    // Sin el script 39 no hay política por rubro: queda la excepción por
    // producto, que es exactamente como funcionaba antes.
    disponible = false;
    r = await leer("nombre");
  }
  if (r.error) throw new Error(r.error.message);

  const row = (r.data ?? null) as { nombre?: string | null; ajuste_pct?: number | string | null } | null;
  const pctRaw = disponible ? Number(row?.ajuste_pct) : NaN;
  return {
    id: catId,
    nombre: row?.nombre ?? null,
    ajuste_pct: Number.isFinite(pctRaw) ? pctRaw : null,
    disponible,
  };
}

/**
 * Aplica el porcentaje del rubro sobre el precio de lista.
 * Negativo baja, positivo sube. Se redondea al guaraní: no existe el céntimo.
 */
export function aplicarAjuste(lista: number, pct: number | null): number {
  if (pct == null || pct === 0) return lista;
  return Math.max(0, Math.round(lista * (1 + pct / 100)));
}

type ProductoPrecio = {
  id: string;
  precio_venta?: number | string | null;
  precio_usd?: number | string | null;
};

/**
 * Resuelve el precio de varios productos para un cliente de una sola vez.
 *
 * El orden importa y es el que el vendedor espera poder explicar:
 *   1. ¿Este producto tiene precio negociado para el rubro del cliente?
 *   2. ¿El rubro tiene un porcentaje? Se aplica sobre el precio de lista.
 *   3. Si no, paga lista.
 *
 * El precio de lista ya sale del dólar cuando el producto está cargado en
 * dólares, así que el porcentaje del rubro se aplica sobre el guaraní de hoy
 * y no sobre un número viejo.
 */
export async function preciosParaCliente(
  sb: Sb,
  empresaId: string,
  clienteId: string | null | undefined,
  productos: ProductoPrecio[],
  tcVenta?: number | null
): Promise<Map<string, PrecioParaCliente>> {
  const tc = tcVenta !== undefined ? tcVenta : await cotizacionVentaUsd(sb, empresaId);
  const rubro = await rubroDelCliente(sb, empresaId, clienteId);

  // Las excepciones del rubro, en una sola consulta para todos los productos.
  const excepciones = new Map<string, number>();
  if (rubro && productos.length > 0) {
    const eQ = await sb
      .from("precios_por_categoria")
      .select("producto_id, precio")
      .eq("categoria_id", rubro.id)
      .in("producto_id", productos.map((p) => p.id));
    if (eQ.error) throw new Error(eQ.error.message);
    for (const row of (eQ.data ?? []) as { producto_id: string; precio: number | string }[]) {
      const n = Number(row.precio);
      if (Number.isFinite(n) && n > 0) excepciones.set(row.producto_id, Math.round(n));
    }
  }

  const out = new Map<string, PrecioParaCliente>();
  for (const p of productos) {
    const lista = precioListaGs(p, tc);
    const base = {
      precio_lista: lista,
      categoria_id: rubro?.id ?? null,
      categoria_nombre: rubro?.nombre ?? null,
      ajuste_pct: rubro?.ajuste_pct ?? null,
      ajuste_disponible: rubro?.disponible ?? false,
    };

    const excepcion = excepciones.get(p.id);
    if (excepcion != null) {
      out.set(p.id, { ...base, precio: excepcion, fuente: "excepcion_producto" });
      continue;
    }
    const pct = rubro?.ajuste_pct ?? null;
    if (pct != null && pct !== 0 && lista > 0) {
      out.set(p.id, { ...base, precio: aplicarAjuste(lista, pct), fuente: "ajuste_rubro" });
      continue;
    }
    out.set(p.id, { ...base, precio: lista, fuente: "lista" });
  }
  return out;
}
