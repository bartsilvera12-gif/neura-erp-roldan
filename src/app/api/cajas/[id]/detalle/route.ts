import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getResumenCaja, getDetalleCaja } from "@/lib/caja/server";

/**
 * GET /api/cajas/[id]/detalle — el cierre de un turno, en JSON.
 *
 * Es el mismo contenido que el arqueo A4, pero para mirarlo en pantalla. Hasta
 * ahora "Ver cierre" abría directamente el PDF: para revisar una venta del
 * turno había que imprimir una hoja, y desde una hoja no se puede entrar a la
 * venta.
 *
 * Usa `getResumenCaja` y `getDetalleCaja`, los mismos que arma el A4, para que
 * la pantalla y la hoja no puedan decir cosas distintas.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id: cajaId } = await context.params;

    const resumen = await getResumenCaja(ctx.supabase, empresaId, cajaId, sucursalId);
    if (!resumen) return NextResponse.json(errorResponse("Turno de caja no encontrado."), { status: 404 });
    const detalle = await getDetalleCaja(ctx.supabase, empresaId, cajaId, sucursalId);

    // Los ítems de las ventas del turno, para poder abrir cada venta sin otra
    // vuelta al servidor. Una sola consulta para todo el turno.
    const ids = (detalle?.ventas ?? []).map((v) => v.id);
    const itemsPorVenta: Record<string, unknown[]> = {};
    if (ids.length) {
      const itQ = await ctx.supabase
        .from("ventas_items")
        .select("venta_id, producto_nombre, sku, cantidad, precio_venta, precio_venta_original, tipo_iva, total_linea")
        .eq("empresa_id", empresaId)
        .in("venta_id", ids);
      if (itQ.error) throw new Error(itQ.error.message);
      for (const r of (itQ.data ?? []) as Array<Record<string, unknown>>) {
        const k = String(r.venta_id);
        (itemsPorVenta[k] ??= []).push({
          producto_nombre: String(r.producto_nombre ?? ""),
          sku: (r.sku as string | null) ?? null,
          cantidad: Number(r.cantidad) || 0,
          precio_venta: Number(r.precio_venta) || 0,
          precio_venta_original: r.precio_venta_original != null ? Number(r.precio_venta_original) : null,
          tipo_iva: (r.tipo_iva as string | null) ?? null,
          total_linea: Number(r.total_linea) || 0,
        });
      }
    }

    return NextResponse.json(
      successResponse({
        caja: resumen.caja,
        ventas: detalle?.ventas ?? [],
        movimientos: detalle?.movimientos ?? [],
        items_por_venta: itemsPorVenta,
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/cajas/[id]/detalle GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el cierre."), { status: 500 });
  }
}
