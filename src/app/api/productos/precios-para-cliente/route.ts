import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { preciosParaCliente } from "@/lib/precios/server/precio-para-cliente";

/**
 * POST /api/productos/precios-para-cliente
 * Body: { cliente_id, producto_ids: string[] }
 *
 * En lote, porque en la caja el cliente se elige después de cargar los items
 * (o se cambia a mitad de la venta) y hay que recalcular todas las líneas de
 * una vez. Una llamada por producto haría parpadear los precios de a uno.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { cliente_id?: unknown; producto_ids?: unknown };
    const clienteId = typeof body.cliente_id === "string" && body.cliente_id ? body.cliente_id : null;
    const ids = Array.isArray(body.producto_ids)
      ? [...new Set(body.producto_ids.filter((x): x is string => typeof x === "string" && !!x))].slice(0, 300)
      : [];
    if (ids.length === 0) return NextResponse.json(successResponse({ precios: [] }));

    // El precio de lista se lee de la base y no se confía al cliente: si el
    // navegador mandara el precio, cualquiera podría pedir un descuento
    // disfrazado de precio de lista.
    const leer = (cols: string) =>
      ctx.supabase.from("productos").select(cols).eq("empresa_id", ctx.auth.empresa_id).in("id", ids);
    let pQ = await leer("id, precio_venta, precio_usd");
    if (pQ.error && /precio_usd/.test(pQ.error.message ?? "")) {
      // Sin el script 37 no hay precios en dólares: todo es guaraní.
      pQ = await leer("id, precio_venta");
    }
    if (pQ.error) throw new Error(pQ.error.message);
    const productos = (pQ.data ?? []) as unknown as { id: string; precio_venta?: number | string | null }[];

    const mapa = await preciosParaCliente(ctx.supabase, ctx.auth.empresa_id, clienteId, productos);
    return NextResponse.json(successResponse({
      precios: [...mapa.entries()].map(([producto_id, v]) => ({ producto_id, ...v })),
    }));
  } catch (err) {
    console.error("[/api/productos/precios-para-cliente POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron resolver los precios."), { status: 500 });
  }
}
