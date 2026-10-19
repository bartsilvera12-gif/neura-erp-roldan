import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/[id]/precios-categoria
 * Devuelve las categorías activas de la empresa + el precio cargado (0 si no hay).
 * PUT: guarda el mapa completo { categoria_id → precio }.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const catsQ = await ctx.supabase
      .from("categorias_cliente")
      .select("id, nombre, orden")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("activa", true)
      .order("orden")
      .order("nombre");
    if (catsQ.error) throw new Error(catsQ.error.message);
    const categorias = (catsQ.data ?? []) as { id: string; nombre: string; orden: number }[];

    const preciosQ = await ctx.supabase
      .from("precios_por_categoria")
      .select("categoria_id, precio")
      .eq("producto_id", productoId);
    if (preciosQ.error) throw new Error(preciosQ.error.message);
    const map = new Map<string, number>();
    for (const p of (preciosQ.data ?? []) as { categoria_id: string; precio: number | string }[]) {
      map.set(p.categoria_id, Number(p.precio) || 0);
    }
    const lista = categorias.map((c) => ({ categoria_id: c.id, nombre: c.nombre, precio: map.get(c.id) ?? 0 }));
    return NextResponse.json(successResponse({ precios: lista }));
  } catch (err) {
    console.error("[/api/productos/[id]/precios-categoria GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los precios."), { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { precios?: unknown };
    const raw = Array.isArray(body.precios) ? body.precios : [];
    const rows = raw
      .map((r) => r as { categoria_id?: unknown; precio?: unknown })
      .filter((r) => typeof r.categoria_id === "string")
      .map((r) => ({
        producto_id: productoId,
        categoria_id: String(r.categoria_id),
        precio: Math.max(0, Number(r.precio) || 0),
      }));

    if (rows.length === 0) return NextResponse.json(successResponse({ ok: true }));

    // Upsert por (producto_id, categoria_id)
    const { error } = await ctx.supabase
      .from("precios_por_categoria")
      .upsert(rows, { onConflict: "producto_id,categoria_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true, guardados: rows.length }));
  } catch (err) {
    console.error("[/api/productos/[id]/precios-categoria PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron guardar los precios."), { status: 500 });
  }
}
