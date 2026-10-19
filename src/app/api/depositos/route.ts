import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/depositos — lista ubicaciones con total de stock y productos con stock.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const ubQ = await supabase
      .from("inventario_ubicaciones")
      .select("id, nombre, codigo, tipo, activo")
      .eq("empresa_id", auth.empresa_id)
      .eq("activo", true)
      .order("nombre");
    if (ubQ.error) return NextResponse.json(errorResponse(ubQ.error.message), { status: 400 });

    const stockQ = await supabase
      .from("inventario_stock_ubicacion")
      .select("ubicacion_id, stock_actual")
      .eq("empresa_id", auth.empresa_id);
    if (stockQ.error) return NextResponse.json(errorResponse(stockQ.error.message), { status: 400 });

    const totales = new Map<string, { total: number; productos_con_stock: number }>();
    for (const row of (stockQ.data ?? []) as Array<{ ubicacion_id: string; stock_actual: number }>) {
      const cur = totales.get(row.ubicacion_id) ?? { total: 0, productos_con_stock: 0 };
      cur.total += Number(row.stock_actual) || 0;
      if (Number(row.stock_actual) > 0) cur.productos_con_stock += 1;
      totales.set(row.ubicacion_id, cur);
    }

    const depositos = ((ubQ.data ?? []) as Array<{ id: string; nombre: string; codigo: string; tipo: string; activo: boolean }>).map((u) => {
      const t = totales.get(u.id) ?? { total: 0, productos_con_stock: 0 };
      return {
        id: u.id,
        nombre: u.nombre,
        codigo: u.codigo,
        tipo: u.tipo,
        activo: u.activo,
        total_stock: t.total,
        productos_con_stock: t.productos_con_stock,
      };
    });

    return NextResponse.json(successResponse({ depositos }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
