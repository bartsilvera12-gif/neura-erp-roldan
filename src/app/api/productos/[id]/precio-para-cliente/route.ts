import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { preciosParaCliente } from "@/lib/precios/server/precio-para-cliente";

/**
 * GET /api/productos/[id]/precio-para-cliente?cliente_id=X
 *
 * Resuelve el precio a cobrarle a ese cliente por ese producto. El orden lo
 * decide `preciosParaCliente`: excepción cargada en la ficha → porcentaje del
 * rubro → precio de lista.
 *
 * `fuente` mantiene el valor viejo `"categoria"` para las dos primeras, porque
 * Presupuestos lo usa para decidir si el precio vino del rubro o no.
 * `fuente_detalle` dice cuál de las dos fue.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const clienteId = new URL(request.url).searchParams.get("cliente_id") ?? "";

    const leer = (cols: string) =>
      ctx.supabase
        .from("productos")
        .select(cols)
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", productoId)
        .maybeSingle();
    let pQ = await leer("id, precio_venta, precio_usd");
    if (pQ.error && /precio_usd/.test(pQ.error.message ?? "")) {
      pQ = await leer("id, precio_venta");
    }
    if (pQ.error) throw new Error(pQ.error.message);
    const prod = (pQ.data ?? null) as unknown as { id: string; precio_venta?: number | string | null } | null;
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const mapa = await preciosParaCliente(ctx.supabase, ctx.auth.empresa_id, clienteId || null, [prod]);
    const r = mapa.get(productoId);
    if (!r) return NextResponse.json(errorResponse("No se pudo resolver el precio."), { status: 500 });

    return NextResponse.json(successResponse({
      precio: r.precio,
      precio_lista: r.precio_lista,
      fuente: r.fuente === "lista" ? "producto_default" : "categoria",
      fuente_detalle: r.fuente,
      categoria_id: r.categoria_id,
      categoria_nombre: r.categoria_nombre,
      ajuste_pct: r.ajuste_pct,
      ajuste_disponible: r.ajuste_disponible,
    }));
  } catch (err) {
    console.error("[/api/productos/[id]/precio-para-cliente GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo resolver el precio."), { status: 500 });
  }
}
