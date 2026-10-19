import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

/**
 * Órdenes de compra (PEDIDO al proveedor). Documento que se le envía al proveedor
 * para que despache el pedido y emita la factura. NO es una compra registrada ni
 * toca inventario/costos; es previo a la compra.
 *
 * GET  /api/ordenes-compra            → lista
 * GET  /api/ordenes-compra?id=...     → una
 * POST /api/ordenes-compra            → crear
 * PATCH  { id, estado }               → cambiar estado (pendiente|recibida|anulada)
 * DELETE ?id=...                      → eliminar
 */

type Item = { descripcion: string; cantidad: number; unidad: string; precio_unitario: number };

function normItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      descripcion: String(o.descripcion ?? "").trim(),
      cantidad: Number(o.cantidad) || 0,
      unidad: String(o.unidad ?? "").trim() || "UNIDAD",
      precio_unitario: Number(o.precio_unitario) || 0,
    };
  }).filter((i) => i.descripcion !== "");
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (id) {
      const { data, error } = await ctx.supabase
        .from("ordenes_compra").select("*")
        .eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle();
      if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
      if (!data) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });
      return NextResponse.json(successResponse({ orden: data }));
    }
    const { data, error } = await ctx.supabase
      .from("ordenes_compra").select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("fecha", { ascending: false })
      .order("numero_control", { ascending: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ ordenes: data ?? [] }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const proveedorNombre = String(body.proveedor_nombre ?? "").trim();
    if (!proveedorNombre) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    const items = normItems(body.items);
    if (items.length === 0) return NextResponse.json(errorResponse("Agregá al menos un ítem."), { status: 400 });

    // Correlativo OC-XXXXXX.
    const maxQ = await ctx.supabase
      .from("ordenes_compra").select("numero_control")
      .eq("empresa_id", empresaId).like("numero_control", "OC-%")
      .order("numero_control", { ascending: false }).limit(1);
    let next = 1;
    const last = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
    const m = last?.match(/^OC-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
    const numeroControl = `OC-${String(next).padStart(6, "0")}`;

    const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : new Date().toISOString().slice(0, 10);
    const insert = {
      empresa_id: empresaId,
      numero_control: numeroControl,
      proveedor_id: body.proveedor_id != null && String(body.proveedor_id).trim() !== "" ? String(body.proveedor_id) : null,
      proveedor_nombre: proveedorNombre,
      fecha,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      estado: "pendiente",
      observaciones: body.observaciones != null && String(body.observaciones).trim() !== "" ? String(body.observaciones).trim() : null,
      items,
      created_by: ctx.auth.user?.id ?? null,
    };
    const { data, error } = await ctx.supabase.from("ordenes_compra").insert(insert).select().single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ orden: data }), { status: 201 });
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta id."), { status: 400 });

    // PATCH acepta ahora dos modos:
    //  - Solo cambio de estado (compatibilidad con "marcarRecibida").
    //  - Edición completa de la orden (proveedor / fecha / moneda / observaciones / items).
    // Se detecta por presencia de campos editables.
    const patch: Record<string, unknown> = {};
    if (body.estado !== undefined) {
      patch.estado = ["pendiente", "recibida", "anulada"].includes(String(body.estado)) ? String(body.estado) : "pendiente";
    }
    if (typeof body.proveedor_nombre === "string" && body.proveedor_nombre.trim() !== "") {
      patch.proveedor_nombre = body.proveedor_nombre.trim();
    }
    if (body.proveedor_id !== undefined) {
      patch.proveedor_id = body.proveedor_id != null && String(body.proveedor_id).trim() !== "" ? String(body.proveedor_id) : null;
    }
    if (typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
      patch.fecha = body.fecha;
    }
    if (body.moneda !== undefined) {
      patch.moneda = body.moneda === "USD" ? "USD" : "PYG";
    }
    if (body.observaciones !== undefined) {
      patch.observaciones = typeof body.observaciones === "string" && body.observaciones.trim() !== "" ? body.observaciones.trim() : null;
    }
    if (body.items !== undefined) {
      const items = normItems(body.items);
      if (items.length === 0) return NextResponse.json(errorResponse("Agregá al menos un ítem."), { status: 400 });
      patch.items = items;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }
    const { error } = await ctx.supabase
      .from("ordenes_compra").update(patch)
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta id."), { status: 400 });
    const { error } = await ctx.supabase
      .from("ordenes_compra").delete()
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
