import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/[id]/precio-para-cliente?cliente_id=X
 *
 * Resuelve el precio de venta a aplicar cuando el usuario elige un cliente en
 * la caja/presupuesto. Orden:
 *  1) Si el cliente tiene `categoria_cliente_id` y hay un precio cargado en
 *     `precios_por_categoria(producto_id, categoria_id)` → devuelve ese.
 *  2) Si no, cae al `precio_venta` del producto.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const clienteId = new URL(request.url).searchParams.get("cliente_id") ?? "";
    let fuente: "categoria" | "producto_default" = "producto_default";
    let categoria_id: string | null = null;

    // 1) Categoría del cliente
    if (clienteId) {
      const cQ = await ctx.supabase
        .from("clientes")
        .select("categoria_cliente_id")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", clienteId)
        .maybeSingle();
      if (cQ.error) throw new Error(cQ.error.message);
      const catId = (cQ.data as { categoria_cliente_id?: string | null } | null)?.categoria_cliente_id ?? null;
      if (catId) {
        categoria_id = catId;
        const [pQ, catQ] = await Promise.all([
          ctx.supabase
            .from("precios_por_categoria")
            .select("precio")
            .eq("producto_id", productoId)
            .eq("categoria_id", catId)
            .maybeSingle(),
          ctx.supabase
            .from("categorias_cliente")
            .select("nombre")
            .eq("id", catId)
            .maybeSingle(),
        ]);
        if (pQ.error) throw new Error(pQ.error.message);
        const precio = pQ.data ? Number((pQ.data as { precio: number | string }).precio) : NaN;
        const categoria_nombre = (catQ.data as { nombre?: string } | null)?.nombre ?? null;
        if (Number.isFinite(precio) && precio > 0) {
          return NextResponse.json(successResponse({
            precio,
            fuente: "categoria",
            categoria_id,
            categoria_nombre,
          }));
        }
      }
    }

    // 2) Fallback: precio_venta del producto
    const prodQ = await ctx.supabase
      .from("productos")
      .select("precio_venta")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", productoId)
      .maybeSingle();
    if (prodQ.error) throw new Error(prodQ.error.message);
    const precio = prodQ.data ? Number((prodQ.data as { precio_venta: number | string }).precio_venta) : 0;
    return NextResponse.json(successResponse({ precio: Number.isFinite(precio) ? precio : 0, fuente, categoria_id }));
  } catch (err) {
    console.error("[/api/productos/[id]/precio-para-cliente GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo resolver el precio."), { status: 500 });
  }
}
