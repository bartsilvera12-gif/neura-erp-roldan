import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * PATCH /api/ventas/[id]
 *
 * Edición segura de una venta ya emitida. NO toca ítems, cantidades, precios,
 * totales ni stock — para eso está Anular + Regenerar. Solo permite corregir
 * datos administrativos:
 *   - cliente_id + cliente_nombre (cambiar cliente asociado)
 *   - metodo_pago (efectivo | tarjeta | transferencia)
 *   - observaciones
 *
 * Bloqueado si la venta está anulada, o si la factura electrónica ya llegó a
 * SET (estado SIFEN aprobado / enviado / en_proceso): esos DE son inmutables.
 */
export const dynamic = "force-dynamic";

const ALLOWED_METODO = new Set(["efectivo", "tarjeta", "transferencia"]);

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    // Estado actual: no editable si anulada, ni si el DE ya está en SET.
    const cur = await ctx.supabase
      .from("ventas")
      .select("id, estado, factura_id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse("Venta no encontrada"), { status: 404 });
    const est = (cur.data as { estado: string | null; factura_id: string | null });
    if (est.estado === "anulada") {
      return NextResponse.json(errorResponse("La venta está anulada; no se puede editar."), { status: 409 });
    }
    if (est.factura_id) {
      const fQ = await ctx.supabase
        .from("facturas")
        .select("estado_sifen")
        .eq("empresa_id", empresaId)
        .eq("id", est.factura_id)
        .maybeSingle();
      const sifen = (fQ.data as { estado_sifen?: string | null } | null)?.estado_sifen ?? null;
      if (sifen && ["aprobado", "enviado", "en_proceso"].includes(sifen)) {
        return NextResponse.json(
          errorResponse("La factura ya fue enviada a SET; no se puede editar la venta."),
          { status: 409 }
        );
      }
    }

    // Solo pisa lo que el body incluye explícitamente (para no borrar datos).
    const update: Record<string, unknown> = {};

    // NOTA: `ventas` en Roldán e Hijos NO tiene columna `cliente_nombre`. El nombre se
    // resuelve por lookup a `clientes` via `cliente_id` al listar (ver
    // /api/ventas/route.ts). Por eso acá solo se persiste `cliente_id`; un nombre
    // ad-hoc de consumidor final que venga en el body se ignora (no hay dónde
    // guardarlo — la lista muestra "Consumidor final" cuando no hay cliente).
    if (Object.prototype.hasOwnProperty.call(body, "cliente_id")) {
      const cid = s(body.cliente_id);
      if (cid) {
        // Verificar que el cliente pertenece a la empresa.
        const cQ = await ctx.supabase
          .from("clientes")
          .select("id")
          .eq("empresa_id", empresaId)
          .eq("id", cid)
          .maybeSingle();
        if (cQ.error) throw new Error(cQ.error.message);
        if (!cQ.data) return NextResponse.json(errorResponse("Cliente inválido."), { status: 400 });
        update.cliente_id = cid;
      } else {
        // Consumidor final: se libera el vínculo.
        update.cliente_id = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "metodo_pago")) {
      const mp = s(body.metodo_pago);
      if (mp !== null && !ALLOWED_METODO.has(mp)) {
        return NextResponse.json(errorResponse("Método de pago inválido."), { status: 400 });
      }
      update.metodo_pago = mp;
    }

    if (Object.prototype.hasOwnProperty.call(body, "observaciones")) {
      update.observaciones = s(body.observaciones);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    const upd = await ctx.supabase
      .from("ventas")
      .update(update)
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select("id, cliente_id, metodo_pago, observaciones")
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json(successResponse({ venta: upd.data }));
  } catch (err) {
    console.error("[/api/ventas/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la venta."), { status: 500 });
  }
}
