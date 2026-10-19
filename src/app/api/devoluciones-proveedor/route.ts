import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Devoluciones a PROVEEDOR (descuentan stock).
 * El usuario devuelve productos a la empresa que se los vendió; al confirmar,
 * por cada ítem se registra un movimiento SALIDA (origen='devolucion_proveedor')
 * y se descuenta `stock_actual` del producto.
 *
 * GET  /api/devoluciones-proveedor            → lista (últimas 200)
 * POST /api/devoluciones-proveedor            → crea devolución + descuenta stock
 */

export const dynamic = "force-dynamic";

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("devoluciones_proveedor")
      .select("id, numero_control, proveedor_id, proveedor_nombre, motivo, total_unidades, usuario_nombre, fecha, created_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ devoluciones: data ?? [] }));
  } catch (err) {
    console.error("[/api/devoluciones-proveedor GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las devoluciones a proveedor."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = ctx.auth.sucursal_id ?? null;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const itemsRaw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const items = itemsRaw
      .map((it) => ({
        producto_id: s(it.producto_id),
        producto_nombre: s(it.producto_nombre) ?? "Producto",
        producto_sku: s(it.producto_sku),
        cantidad: num(it.cantidad),
        costo_unitario: num(it.costo_unitario),
      }))
      .filter((it) => it.producto_id && it.cantidad > 0);
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Agregá al menos un producto con cantidad."), { status: 400 });
    }

    // Próximo número DEV-PROV-XXXXXX (documento no fiscal, numeración simple).
    const prev = await ctx.supabase
      .from("devoluciones_proveedor")
      .select("numero_control")
      .eq("empresa_id", empresaId);
    let max = 0;
    for (const r of (prev.data ?? []) as Array<{ numero_control: string | null }>) {
      const m = /(\d+)\s*$/.exec(String(r.numero_control ?? ""));
      if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    }
    const numeroControl = `DEV-PROV-${String(max + 1).padStart(6, "0")}`;
    const totalUnidades = items.reduce((a, it) => a + it.cantidad, 0);

    // 1) Cabecera.
    const insHead = await ctx.supabase
      .from("devoluciones_proveedor")
      .insert({
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        proveedor_id: s(body.proveedor_id),
        proveedor_nombre: s(body.proveedor_nombre),
        numero_control: numeroControl,
        motivo: s(body.motivo),
        total_unidades: totalUnidades,
        // Datos de transporte para la remisión (documento no fiscal).
        nr_chofer_nombre: s(body.nr_chofer_nombre),
        nr_chofer_ci: s(body.nr_chofer_ci),
        nr_chofer_telefono: s(body.nr_chofer_telefono),
        nr_transporte_marca: s(body.nr_transporte_marca),
        nr_transporte_chapa: s(body.nr_transporte_chapa),
        nr_transporte_color: s(body.nr_transporte_color),
        receptor_nombre: s(body.receptor_nombre),
        receptor_telefono: s(body.receptor_telefono),
        created_by: ctx.auth.usuarioCatalogId ?? null,
        usuario_nombre: ctx.auth.user?.email ?? null,
      })
      .select("id, numero_control")
      .single();
    if (insHead.error) throw new Error(insHead.error.message);
    const devId = (insHead.data as { id: string }).id;

    // 2) Ítems.
    const insItems = await ctx.supabase.from("devoluciones_proveedor_items").insert(
      items.map((it) => ({
        empresa_id: empresaId,
        devolucion_id: devId,
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        producto_sku: it.producto_sku,
        cantidad: it.cantidad,
        costo_unitario: it.costo_unitario,
      }))
    );
    if (insItems.error) throw new Error(insItems.error.message);

    // 3) Stock: movimiento SALIDA + descuento de stock_actual por producto.
    const referencia = `Devolución a proveedor ${s(body.proveedor_nombre) ?? ""} (${numeroControl})`.trim();
    const nowIso = new Date().toISOString();
    const warnings: string[] = [];
    for (const it of items) {
      // Stock actual del producto.
      const pQ = await ctx.supabase
        .from("productos")
        .select("stock_actual")
        .eq("empresa_id", empresaId)
        .eq("id", it.producto_id as string)
        .maybeSingle();
      const stockActual = num((pQ.data as { stock_actual?: number } | null)?.stock_actual);
      const nuevoStock = Math.max(0, stockActual - it.cantidad);

      const mov = await ctx.supabase.from("movimientos_inventario").insert({
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        producto_sku: it.producto_sku,
        tipo: "SALIDA",
        cantidad: it.cantidad,
        costo_unitario: it.costo_unitario,
        origen: "devolucion_proveedor",
        referencia,
        fecha: nowIso,
      });
      if (mov.error) {
        warnings.push(it.producto_nombre);
        continue;
      }
      const upd = await ctx.supabase
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("empresa_id", empresaId)
        .eq("id", it.producto_id as string);
      if (upd.error) warnings.push(it.producto_nombre);
    }

    return NextResponse.json(
      successResponse({
        devolucion: { id: devId, numero_control: numeroControl, total_unidades: totalUnidades },
        stock_warning: warnings.length
          ? `La devolución se guardó, pero no se pudo descontar stock de: ${warnings.join(", ")}.`
          : null,
      })
    );
  } catch (err) {
    console.error("[/api/devoluciones-proveedor POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar la devolución a proveedor."), { status: 500 });
  }
}
