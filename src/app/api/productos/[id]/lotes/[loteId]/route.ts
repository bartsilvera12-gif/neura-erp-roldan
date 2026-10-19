import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ajustarStockProducto, contribucionLote } from "@/lib/inventario/server/lote-stock-sync";

/**
 * PATCH /api/productos/[id]/lotes/[loteId] — editar cantidad / activo / observaciones / fecha.
 * DELETE                                    — soft delete (activo=false).
 */

const LOTE_COLS =
  "id, numero_lote, fecha_vencimiento, cantidad, cantidad_original, fecha_ingreso, activo, observaciones";

function rowToApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    cantidad: typeof r.cantidad === "string" ? Number(r.cantidad) : r.cantidad,
    cantidad_original:
      typeof r.cantidad_original === "string" ? Number(r.cantidad_original) : r.cantidad_original,
  };
}

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; loteId: string }> }
) {
  try {
    const { id, loteId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.cantidad !== undefined) {
      const n = Number(body.cantidad);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(errorResponse("Cantidad inválida."), { status: 400 });
      }
      patch.cantidad = n;
    }
    if (body.numero_lote !== undefined) {
      const v = String(body.numero_lote).trim();
      if (!v) return NextResponse.json(errorResponse("Número de lote inválido."), { status: 400 });
      patch.numero_lote = v;
    }
    if (body.fecha_vencimiento !== undefined) {
      const v = String(body.fecha_vencimiento);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json(errorResponse("Fecha inválida (YYYY-MM-DD)."), { status: 400 });
      }
      patch.fecha_vencimiento = v;
    }
    if (body.observaciones !== undefined) {
      const v = body.observaciones == null ? null : String(body.observaciones).trim() || null;
      patch.observaciones = v;
    }
    if (typeof body.activo === "boolean") patch.activo = body.activo;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    // Estado previo para calcular el ajuste de stock (invariante stock = suma de
    // lotes activos). Contribución = cantidad si el lote está activo, si no 0.
    const beforeQ = await ctx.supabase
      .from("producto_lotes")
      .select("cantidad, activo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("id", loteId)
      .maybeSingle();
    const before = (beforeQ.data ?? null) as { cantidad: number | string; activo: boolean } | null;

    const upd = await ctx.supabase
      .from("producto_lotes")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("id", loteId)
      .select(LOTE_COLS)
      .maybeSingle();

    if (upd.error) {
      const msg = upd.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe un lote con ese número para este producto."),
          { status: 409 }
        );
      }
      console.error("[/api/productos/[id]/lotes/[loteId] PATCH]", msg);
      return NextResponse.json(errorResponse("No se pudo actualizar el lote."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    // Ajustar stock total por el delta de contribución del lote.
    if (before) {
      const after = upd.data as unknown as { cantidad: number | string; activo: boolean };
      const contribAntes = contribucionLote(Number(before.cantidad) || 0, before.activo === true);
      const contribDespues = contribucionLote(Number(after.cantidad) || 0, after.activo === true);
      await ajustarStockProducto(ctx.supabase, ctx.auth.empresa_id, id, contribDespues - contribAntes);
    }

    return NextResponse.json(
      successResponse({ lote: rowToApi(upd.data as unknown as Record<string, unknown>) })
    );
  } catch (err) {
    console.error("[/api/productos/[id]/lotes/[loteId] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el lote."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; loteId: string }> }
) {
  try {
    const { id, loteId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    // Estado previo: al desactivar el lote, su cantidad deja de contar en el stock
    // total, así que se resta (solo si estaba activo).
    const beforeQ = await ctx.supabase
      .from("producto_lotes")
      .select("cantidad, activo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("id", loteId)
      .maybeSingle();
    const before = (beforeQ.data ?? null) as { cantidad: number | string; activo: boolean } | null;

    const { error } = await ctx.supabase
      .from("producto_lotes")
      .update({ activo: false })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .eq("id", loteId);
    if (error) {
      console.error("[/api/productos/[id]/lotes/[loteId] DELETE]", error.message);
      return NextResponse.json(errorResponse("No se pudo eliminar el lote."), { status: 500 });
    }

    if (before) {
      const contribAntes = contribucionLote(Number(before.cantidad) || 0, before.activo === true);
      await ajustarStockProducto(ctx.supabase, ctx.auth.empresa_id, id, -contribAntes);
    }

    return NextResponse.json(successResponse({ ok: true, id: loteId }));
  } catch (err) {
    console.error("[/api/productos/[id]/lotes/[loteId] DELETE] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el lote."), { status: 500 });
  }
}
