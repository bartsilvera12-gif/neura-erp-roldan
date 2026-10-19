import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const COLS =
  "id, empresa_id, numero, fecha, emisor, ubicacion_origen_id, ubicacion_destino_id, motivo, estado, motivo_rechazo, aprobada_at, aprobada_por, transportista, ruc_transportista, conductor, ci_conductor, chapa, fecha_inicio_traslado, fecha_fin_traslado, observaciones, created_at, updated_at";

/** GET /api/notas-remision/[id] — detalle con items + nombres de ubicación. */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const nrQ = await supabase
      .from("notas_remision")
      .select(COLS)
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (nrQ.error) throw new Error(nrQ.error.message);
    if (!nrQ.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const nr = nrQ.data as Record<string, unknown>;

    const [itemsQ, ubQ] = await Promise.all([
      supabase
        .from("notas_remision_items")
        .select("producto_id, cantidad")
        .eq("nota_remision_id", id),
      supabase
        .from("inventario_ubicaciones")
        .select("id, nombre, codigo")
        .eq("empresa_id", auth.empresa_id)
        .in("id", [nr.ubicacion_origen_id as string, nr.ubicacion_destino_id as string]),
    ]);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    if (ubQ.error) throw new Error(ubQ.error.message);
    const items = (itemsQ.data ?? []) as Array<{ producto_id: string; cantidad: number }>;
    const ubMap = new Map<string, { nombre: string; codigo: string }>();
    for (const u of (ubQ.data ?? []) as Array<{ id: string; nombre: string; codigo: string }>) {
      ubMap.set(u.id, { nombre: u.nombre, codigo: u.codigo });
    }

    // Nombres de productos para mostrar en el detalle
    const prodIds = Array.from(new Set(items.map((i) => i.producto_id)));
    const prodMap = new Map<string, { nombre: string; sku: string }>();
    if (prodIds.length > 0) {
      const pQ = await supabase
        .from("productos")
        .select("id, nombre, sku")
        .eq("empresa_id", auth.empresa_id)
        .in("id", prodIds);
      if (pQ.error) throw new Error(pQ.error.message);
      for (const p of (pQ.data ?? []) as Array<{ id: string; nombre: string; sku: string | null }>) {
        prodMap.set(p.id, { nombre: p.nombre, sku: p.sku ?? "" });
      }
    }

    const detalleItems = items.map((i) => ({
      producto_id: i.producto_id,
      producto_nombre: prodMap.get(i.producto_id)?.nombre ?? "?",
      producto_sku: prodMap.get(i.producto_id)?.sku ?? "",
      cantidad: Number(i.cantidad),
    }));

    return NextResponse.json(successResponse({
      nota_remision: {
        ...nr,
        origen: ubMap.get(nr.ubicacion_origen_id as string) ?? null,
        destino: ubMap.get(nr.ubicacion_destino_id as string) ?? null,
        items: detalleItems,
      },
    }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
