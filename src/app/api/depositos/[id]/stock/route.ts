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

    // Lo que hay en ESTA ubicación. Es la lista corta: la mayoría de los
    // productos del catálogo no están en ningún depósito.
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

    type ProdFila = { id: string; nombre: string; sku: string | null; unidad_medida: string | null };

    /**
     * Los productos a mostrar.
     *
     * ── POR QUÉ DOS CAMINOS Y NO UNO ──────────────────────────────────────
     *   Con `solo_con_stock` se piden SOLO los que están en el depósito, que
     *   suelen ser un puñado. Traer el catálogo entero para después filtrar
     *   983 ceros es trabajo tirado, y encima PostgREST corta en 1000 filas:
     *   con 1.002 productos cargados, los dos últimos no existían para esta
     *   pantalla y nadie se iba a enterar.
     *
     *   Sin el filtro se trae el catálogo por tandas, por el mismo tope.
     */
    const productos: ProdFila[] = [];
    if (soloConStock) {
      const conStock = [...stockMap.entries()].filter(([, n]) => n > 0).map(([id]) => id);
      const TANDA = 200;
      for (let i = 0; i < conStock.length; i += TANDA) {
        const q = await supabase
          .from("productos")
          .select("id, nombre, sku, unidad_medida")
          .eq("empresa_id", auth.empresa_id)
          .in("id", conStock.slice(i, i + TANDA))
          .order("nombre");
        if (q.error) throw new Error(q.error.message);
        productos.push(...((q.data ?? []) as ProdFila[]));
      }
      productos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    } else {
      const PAGINA = 500;
      for (let desde = 0; ; desde += PAGINA) {
        const q = await supabase
          .from("productos")
          .select("id, nombre, sku, unidad_medida")
          .eq("empresa_id", auth.empresa_id)
          .eq("activo", true)
          .order("nombre")
          .range(desde, desde + PAGINA - 1);
        if (q.error) throw new Error(q.error.message);
        const tanda = (q.data ?? []) as ProdFila[];
        productos.push(...tanda);
        if (tanda.length < PAGINA) break;
      }
    }

    let items = productos.map((p) => ({
      producto_id: p.id,
      nombre: p.nombre,
      sku: p.sku ?? "",
      unidad: p.unidad_medida ?? "",
      stock: stockMap.get(p.id) ?? 0,
    }));
    if (buscar) items = items.filter((i) => i.nombre.toLowerCase().includes(buscar) || i.sku.toLowerCase().includes(buscar));

    const total = items.reduce((s, i) => s + i.stock, 0);

    return NextResponse.json(successResponse({
      deposito: ubQ.data,
      items,
      total_stock: total,
      productos_con_stock: items.filter((i) => i.stock > 0).length,
      // Cuántos están realmente en el depósito, mire lo que mire la pantalla.
      // Sin esto, con el filtro puesto el contador diría "1 de 1".
      productos_en_deposito: [...stockMap.values()].filter((n) => n > 0).length,
    }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
