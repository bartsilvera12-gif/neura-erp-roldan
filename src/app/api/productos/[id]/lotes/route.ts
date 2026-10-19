import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ajustarStockProducto } from "@/lib/inventario/server/lote-stock-sync";

/**
 * GET /api/productos/[id]/lotes — lista lotes activos con cantidad > 0.
 * POST /api/productos/[id]/lotes — crea un lote manual (alta directa).
 * Los lotes que provienen de una compra se crean en /api/compras (POST).
 */

const LOTE_COLS =
  "id, numero_lote, fecha_vencimiento, cantidad, cantidad_original, fecha_ingreso, activo, observaciones";

function toNumber(v: unknown): unknown {
  return typeof v === "string" ? Number(v) : v;
}

function rowToApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    cantidad: toNumber(r.cantidad),
    cantidad_original: toNumber(r.cantidad_original),
  };
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("producto_lotes")
      .select(LOTE_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("activo", true)
      .gt("cantidad", 0)
      .order("fecha_vencimiento", { ascending: true });

    if (error) throw new Error(error.message);
    const lotes = ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToApi);
    return NextResponse.json(successResponse({ lotes }));
  } catch (err) {
    console.error("[/api/productos/[id]/lotes GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los lotes."), { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const numeroLote = typeof body.numero_lote === "string" ? body.numero_lote.trim() : "";
    if (!numeroLote) {
      return NextResponse.json(errorResponse("El número de lote es obligatorio."), { status: 400 });
    }
    const fechaVenc = typeof body.fecha_vencimiento === "string" ? body.fecha_vencimiento : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaVenc)) {
      return NextResponse.json(
        errorResponse("La fecha de vencimiento es obligatoria (YYYY-MM-DD)."),
        { status: 400 }
      );
    }
    const cantidad = Number(body.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return NextResponse.json(errorResponse("La cantidad debe ser mayor a 0."), { status: 400 });
    }
    const observaciones =
      typeof body.observaciones === "string" && body.observaciones.trim() !== ""
        ? body.observaciones.trim()
        : null;

    const insertPayload = {
      empresa_id: ctx.auth.empresa_id,
      producto_id: id,
      numero_lote: numeroLote,
      fecha_vencimiento: fechaVenc,
      cantidad,
      cantidad_original: cantidad,
      observaciones,
      activo: true,
    };

    const ins = await ctx.supabase
      .from("producto_lotes")
      .insert(insertPayload)
      .select(LOTE_COLS)
      .single();

    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe un lote con ese número para este producto."),
          { status: 409 }
        );
      }
      console.error("[/api/productos/[id]/lotes POST]", msg);
      return NextResponse.json(errorResponse("No se pudo crear el lote."), { status: 500 });
    }
    // Sincronizar stock total: la cantidad del lote nuevo se suma al stock del
    // producto (invariante: stock_actual = suma de lotes activos).
    await ajustarStockProducto(ctx.supabase, ctx.auth.empresa_id, id, cantidad);
    return NextResponse.json(
      successResponse({ lote: rowToApi(ins.data as unknown as Record<string, unknown>) })
    );
  } catch (err) {
    console.error("[/api/productos/[id]/lotes POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear el lote."), { status: 500 });
  }
}
