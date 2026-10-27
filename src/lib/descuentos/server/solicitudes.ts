import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Pedidos de descuento por encima del tope del vendedor.
 *
 * ── CÓMO FUNCIONA ─────────────────────────────────────────────────────────
 *   El vendedor escribe un descuento mayor al que tiene permitido y pide
 *   autorización. El administrador la ve en la campana del encabezado y
 *   contesta. Si aprueba, la próxima venta de ese producto por ese vendedor
 *   puede llevar hasta ese descuento, una sola vez y dentro de los 15 minutos.
 *
 * ── POR QUÉ SE CONSUME DESPUÉS DE CREAR LA VENTA Y NO ANTES ───────────────
 *   Caja reintenta: cuando falta stock, el primer POST falla pidiendo
 *   confirmación y el segundo pasa con `permitirSinStock`. Si la autorización
 *   se marcara usada en la validación, el reintento se quedaría sin permiso y
 *   el vendedor tendría que pedir de nuevo con el cliente adelante.
 *
 *   El riesgo teórico —dos ventas en paralelo con la misma autorización— pide
 *   dos pestañas de Caja y un par de segundos de puntería. A cambio, el
 *   camino normal no se rompe. La autorización igual vence sola.
 */

/** Cuánto vale una autorización antes de vencer. */
export const MINUTOS_VIGENCIA = 15;

/** Diferencia tolerada al comparar porcentajes, por el redondeo a guaraníes. */
const TOLERANCIA_PCT = 0.05;

export type EstadoSolicitud = "pendiente" | "aprobada" | "rechazada" | "usada";

export interface SolicitudDescuento {
  id: string;
  solicitante_id: string;
  solicitante_nombre: string | null;
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_lista: number;
  precio_pedido: number;
  descuento_pct: number;
  tope_pct: number | null;
  motivo: string | null;
  estado: EstadoSolicitud;
  resuelta_por_nombre: string | null;
  resuelta_at: string | null;
  respuesta_motivo: string | null;
  expira_at: string;
  created_at: string;
  /** Calculado: la aprobación ya no sirve aunque el estado diga "aprobada". */
  vencida: boolean;
}

const COLS =
  "id, solicitante_id, solicitante_nombre, producto_id, producto_nombre, sku, cantidad, " +
  "precio_lista, precio_pedido, descuento_pct, tope_pct, motivo, estado, " +
  "resuelta_por_id, resuelta_por_nombre, resuelta_at, respuesta_motivo, expira_at, created_at";

const n = (v: unknown): number => Number(v) || 0;

function mapear(r: Record<string, unknown>): SolicitudDescuento {
  const expira = String(r.expira_at);
  return {
    id: String(r.id),
    solicitante_id: String(r.solicitante_id),
    solicitante_nombre: (r.solicitante_nombre as string | null) ?? null,
    producto_id: (r.producto_id as string | null) ?? null,
    producto_nombre: String(r.producto_nombre ?? ""),
    sku: (r.sku as string | null) ?? null,
    cantidad: n(r.cantidad),
    precio_lista: n(r.precio_lista),
    precio_pedido: n(r.precio_pedido),
    descuento_pct: n(r.descuento_pct),
    tope_pct: r.tope_pct == null ? null : n(r.tope_pct),
    motivo: (r.motivo as string | null) ?? null,
    estado: String(r.estado) as EstadoSolicitud,
    resuelta_por_nombre: (r.resuelta_por_nombre as string | null) ?? null,
    resuelta_at: (r.resuelta_at as string | null) ?? null,
    respuesta_motivo: (r.respuesta_motivo as string | null) ?? null,
    expira_at: expira,
    created_at: String(r.created_at),
    vencida: new Date(expira).getTime() < Date.now(),
  };
}

export interface NuevaSolicitud {
  empresaId: string;
  sucursalId: string | null;
  solicitanteId: string;
  solicitanteNombre: string | null;
  productoId: string | null;
  productoNombre: string;
  sku: string | null;
  cantidad: number;
  precioLista: number;
  precioPedido: number;
  descuentoPct: number;
  topePct: number | null;
  motivo: string | null;
}

export async function crearSolicitud(
  sb: AppSupabaseClient,
  p: NuevaSolicitud
): Promise<SolicitudDescuento> {
  const expira = new Date(Date.now() + MINUTOS_VIGENCIA * 60_000).toISOString();
  const r = await sb
    .from("solicitudes_descuento")
    .insert({
      empresa_id: p.empresaId,
      sucursal_id: p.sucursalId,
      solicitante_id: p.solicitanteId,
      solicitante_nombre: p.solicitanteNombre,
      producto_id: p.productoId,
      producto_nombre: p.productoNombre,
      sku: p.sku,
      cantidad: p.cantidad,
      precio_lista: p.precioLista,
      precio_pedido: p.precioPedido,
      descuento_pct: p.descuentoPct,
      tope_pct: p.topePct,
      motivo: p.motivo,
      estado: "pendiente",
      expira_at: expira,
    })
    .select(COLS)
    .single();
  if (r.error) throw new Error(r.error.message);
  return mapear(r.data as unknown as Record<string, unknown>);
}

/** Lo que el administrador tiene para contestar. */
export async function listarPendientes(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<SolicitudDescuento[]> {
  const r = await sb
    .from("solicitudes_descuento")
    .select(COLS)
    .eq("empresa_id", empresaId)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false })
    .limit(50);
  if (r.error) throw new Error(r.error.message);
  // Las vencidas no se muestran: contestar una de hace una hora no le sirve a
  // nadie, y el vendedor ya resolvió la venta de otra forma.
  return ((r.data ?? []) as unknown as Record<string, unknown>[]).map(mapear).filter((s) => !s.vencida);
}

export async function leerSolicitud(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string
): Promise<SolicitudDescuento | null> {
  const r = await sb
    .from("solicitudes_descuento")
    .select(COLS)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data ? mapear(r.data as unknown as Record<string, unknown>) : null;
}

/**
 * El administrador contesta. Solo cambia una pendiente: contestar dos veces la
 * misma —dos administradores mirando la campana a la vez— no puede pisar la
 * primera respuesta.
 */
export async function resolverSolicitud(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  p: { aprobar: boolean; porId: string | null; porNombre: string | null; motivo: string | null }
): Promise<SolicitudDescuento | null> {
  const r = await sb
    .from("solicitudes_descuento")
    .update({
      estado: p.aprobar ? "aprobada" : "rechazada",
      resuelta_por_id: p.porId,
      resuelta_por_nombre: p.porNombre,
      resuelta_at: new Date().toISOString(),
      respuesta_motivo: p.motivo,
    })
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .eq("estado", "pendiente")
    .select(COLS)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data ? mapear(r.data as unknown as Record<string, unknown>) : null;
}

export interface LineaAAutorizar {
  producto_id: string;
  producto_nombre?: string | null;
  pct: number;
}

/**
 * Busca, para cada línea que pasa el tope, una autorización aprobada que la
 * cubra. Devuelve los ids a consumir, o el nombre de la primera línea que se
 * quedó sin permiso.
 *
 * Una autorización cubre a una línea si es del mismo vendedor, del mismo
 * producto, no está vencida y aprobó un porcentaje igual o mayor. Mayor sirve:
 * si el administrador aprobó 30 y el vendedor terminó dando 25, el permiso
 * alcanza de sobra.
 */
export async function buscarAutorizaciones(
  sb: AppSupabaseClient,
  empresaId: string,
  solicitanteId: string,
  lineas: LineaAAutorizar[]
): Promise<{ ok: true; ids: string[] } | { ok: false; faltaPara: string }> {
  if (lineas.length === 0) return { ok: true, ids: [] };

  const r = await sb
    .from("solicitudes_descuento")
    .select("id, producto_id, descuento_pct, expira_at")
    .eq("empresa_id", empresaId)
    .eq("solicitante_id", solicitanteId)
    .eq("estado", "aprobada")
    .gte("expira_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (r.error) throw new Error(r.error.message);

  const libres = ((r.data ?? []) as Array<{ id: string; producto_id: string | null; descuento_pct: number | string }>)
    .map((x) => ({ id: x.id, producto_id: x.producto_id, pct: Number(x.descuento_pct) || 0 }));

  const usadas = new Set<string>();
  const ids: string[] = [];
  for (const l of lineas) {
    const match = libres.find(
      (a) => !usadas.has(a.id) && a.producto_id === l.producto_id && a.pct + TOLERANCIA_PCT >= l.pct
    );
    if (!match) return { ok: false, faltaPara: l.producto_nombre || "un producto" };
    usadas.add(match.id);
    ids.push(match.id);
  }
  return { ok: true, ids };
}

/** Marca las autorizaciones como usadas por una venta ya creada. */
export async function marcarUsadas(
  sb: AppSupabaseClient,
  empresaId: string,
  ids: string[],
  ventaId: string
): Promise<void> {
  if (ids.length === 0) return;
  const r = await sb
    .from("solicitudes_descuento")
    .update({ estado: "usada", usada_en_venta_id: ventaId, usada_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .in("id", ids);
  // Que falle el marcado no puede tirar abajo una venta ya registrada: se
  // anota y sigue. Lo peor es una autorización que queda disponible unos
  // minutos más, hasta que vence.
  if (r.error) console.error("[solicitudes-descuento] marcarUsadas:", r.error.message);
}
