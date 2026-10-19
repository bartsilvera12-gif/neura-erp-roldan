import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * /api/ordenes-venta — órdenes de compra RECIBIDAS de clientes (Biggie, Casa
 * Rica, Arete, etc.). Distinto de /api/ordenes-compra que son OC salientes
 * (yo compro a proveedor). Peter las carga manualmente por ahora; más
 * adelante se puede enchufar a webhooks de Cepsa.
 *
 * Estados: pendiente → aprobada → procesada (se convierte a venta) o
 * rechazada. Cancelada aplica si el cliente la anula antes de aprobar.
 */

type ItemIn = { producto_id: string; cantidad: number; precio_unitario: number };

const COLS =
  "id, empresa_id, sucursal_id, cliente_id, numero_orden, fecha, fecha_entrega_solicitada, estado, motivo_rechazo, observaciones, subtotal, monto_iva, total, venta_id, created_at, updated_at";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const sp = new URL(request.url).searchParams;

    let q = supabase
      .from("ordenes_venta")
      .select(COLS)
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });

    const estado = sp.get("estado");
    if (estado) q = q.eq("estado", estado);
    const cliente = sp.get("cliente_id");
    if (cliente) q = q.eq("cliente_id", cliente);
    const buscar = (sp.get("buscar") ?? "").trim();
    if (buscar) q = q.ilike("numero_orden", `%${buscar}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return NextResponse.json(successResponse({ ordenes: [] }));

    const ids = rows.map((r) => String(r.id));
    const itemsQ = await supabase
      .from("ordenes_venta_items")
      .select("orden_id, producto_id, cantidad, precio_unitario, subtotal")
      .in("orden_id", ids);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    const byOrden = new Map<string, unknown[]>();
    for (const it of (itemsQ.data ?? []) as Array<{ orden_id: string } & Record<string, unknown>>) {
      const arr = byOrden.get(it.orden_id) ?? [];
      arr.push(it);
      byOrden.set(it.orden_id, arr);
    }
    const ordenes = rows.map((r) => ({ ...r, items: byOrden.get(String(r.id)) ?? [] }));
    return NextResponse.json(successResponse({ ordenes }));
  } catch (err) {
    console.error("[/api/ordenes-venta GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las órdenes."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as {
      cliente_id?: unknown;
      numero_orden?: unknown;
      fecha?: unknown;
      fecha_entrega_solicitada?: unknown;
      observaciones?: unknown;
      items?: unknown;
    };
    const clienteId = typeof body.cliente_id === "string" ? body.cliente_id.trim() : "";
    const numeroOrden = typeof body.numero_orden === "string" ? body.numero_orden.trim() : "";
    if (!clienteId || !numeroOrden) {
      return NextResponse.json(errorResponse("cliente_id y numero_orden son obligatorios."), { status: 400 });
    }
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items: ItemIn[] = itemsRaw
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.producto_id === "string" && Number(r.cantidad) > 0)
      .map((r) => ({
        producto_id: String(r.producto_id),
        cantidad: Number(r.cantidad),
        precio_unitario: Math.max(0, Number(r.precio_unitario) || 0),
      }));
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Al menos un ítem."), { status: 400 });
    }
    const subtotal = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);

    const ins = await supabase
      .from("ordenes_venta")
      .insert({
        empresa_id: auth.empresa_id,
        sucursal_id: auth.sucursal_id ?? null,
        cliente_id: clienteId,
        numero_orden: numeroOrden,
        fecha: typeof body.fecha === "string" && body.fecha ? body.fecha : new Date().toISOString().slice(0, 10),
        fecha_entrega_solicitada: typeof body.fecha_entrega_solicitada === "string" ? body.fecha_entrega_solicitada : null,
        observaciones: typeof body.observaciones === "string" ? body.observaciones : null,
        estado: "pendiente",
        subtotal, monto_iva: 0, total: subtotal,
      })
      .select("id")
      .maybeSingle();
    if (ins.error) throw new Error(ins.error.message);
    const ordenId = (ins.data as { id: string } | null)?.id;
    if (!ordenId) throw new Error("No se pudo crear la orden.");

    const itemsRows = items.map((i) => ({
      orden_id: ordenId,
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.cantidad * i.precio_unitario,
    }));
    const insItems = await supabase.from("ordenes_venta_items").insert(itemsRows);
    if (insItems.error) throw new Error(insItems.error.message);

    return NextResponse.json(successResponse({ orden_id: ordenId }));
  } catch (err) {
    console.error("[/api/ordenes-venta POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la orden."), { status: 500 });
  }
}
