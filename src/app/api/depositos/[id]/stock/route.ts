import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/depositos/[id]/stock — stock por producto en un depósito específico.
 * ?buscar=… para filtrar por nombre/SKU.
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ubicacionId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const { searchParams } = new URL(request.url);
    const buscar = (searchParams.get("buscar") ?? "").trim().toLowerCase();
    const soloConStock = searchParams.get("solo_con_stock") === "1";

    const ubQ = await supabase
      .from("inventario_ubicaciones")
      .select("id, nombre, codigo")
      .eq("empresa_id", auth.empresa_id)
      .eq("id", ubicacionId)
      .maybeSingle();
    if (ubQ.error) throw new Error(ubQ.error.message);
    if (!ubQ.data) return NextResponse.json(errorResponse("Depósito no encontrado."), { status: 404 });

    // Traer todos los productos activos + su stock en la ubicación (LEFT JOIN manual)
    const prodQ = await supabase
      .from("productos")
      .select("id, nombre, sku, unidad_medida, controla_stock, activo")
      .eq("empresa_id", auth.empresa_id)
      .eq("activo", true)
      .order("nombre");
    if (prodQ.error) throw new Error(prodQ.error.message);
    const productos = (prodQ.data ?? []) as Array<{ id: string; nombre: string; sku: string | null; unidad_medida: string | null; controla_stock: boolean | null }>;

    const stockQ = await supabase
      .from("inventario_stock_ubicacion")
      .select("producto_id, stock_actual")
      .eq("empresa_id", auth.empresa_id)
      .eq("ubicacion_id", ubicacionId);
    if (stockQ.error) throw new Error(stockQ.error.message);
    const stockMap = new Map<string, number>();
    for (const r of (stockQ.data ?? []) as Array<{ producto_id: string; stock_actual: number }>) {
      stockMap.set(r.producto_id, Number(r.stock_actual) || 0);
    }

    let items = productos.map((p) => ({
      producto_id: p.id,
      nombre: p.nombre,
      sku: p.sku ?? "",
      unidad: p.unidad_medida ?? "",
      stock: stockMap.get(p.id) ?? 0,
    }));

    if (soloConStock) items = items.filter((i) => i.stock > 0);
    if (buscar) items = items.filter((i) => i.nombre.toLowerCase().includes(buscar) || i.sku.toLowerCase().includes(buscar));

    const total = items.reduce((s, i) => s + i.stock, 0);

    return NextResponse.json(successResponse({
      deposito: ubQ.data,
      items,
      total_stock: total,
      productos_con_stock: items.filter((i) => i.stock > 0).length,
    }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
