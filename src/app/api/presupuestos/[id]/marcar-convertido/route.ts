import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { avisarCambiosAlCobrar } from "@/lib/presupuestos/server/aviso-cambios";
import { asignarCarteraPorPresupuesto } from "@/lib/comisiones/server/cartera-presupuesto";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";

/**
 * POST /api/presupuestos/[id]/marcar-convertido
 *
 * Marca un presupuesto aprobado como 'convertido' apuntando a la venta que
 * lo cobró. Usa la columna existente `convertido_pedido_id` para guardar el
 * `venta_id` (semántica bendecida para Ferrecolor: convertido a venta, no a
 * pedido).
 *
 * Body: { venta_id: string }
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ventaId = body.venta_id != null ? String(body.venta_id) : null;
    if (!ventaId) {
      return NextResponse.json(errorResponse("venta_id es obligatorio."), { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("presupuestos")
      .update({
        estado: "convertido",
        convertido_pedido_id: ventaId,
        // También en convertido_venta_id: es la columna que leen el listado
        // de Ventas (presupuesto de origen), las reservas y el detalle. Antes
        // solo se llenaba la otra y la venta no encontraba su presupuesto.
        convertido_venta_id: ventaId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id)
      .neq("estado", "convertido") // idempotente
      // Un borrador no se cobra: le faltan los datos del cliente y la ficha
      // todavía no existe. Se completa primero, desde la edición. La venta en
      // sí no se frena por esto —la cobra el que esté en Caja— pero el
      // presupuesto no queda marcado como convertido si era un borrador.
      .neq("estado", "borrador");
    if (error) throw new Error(error.message);

    // Si en la caja se le cambió algo al presupuesto, le queda el aviso a la
    // vendedora que lo armó. La comparación se hace acá, leyendo las dos
    // puntas de la base: si la mandara la pantalla de caja, quien cobra
    // estaría contando lo que él mismo cambió.
    const cambios = await avisarCambiosAlCobrar(
      ctx.supabase,
      ctx.auth.empresa_id,
      id,
      ventaId
    );

    // El cliente pasa a la cartera del vendedor del presupuesto por los días
    // de cartera (pedido del cliente). Si ya es de otro vendedor y está
    // vigente, se queda donde está. Best-effort: el cobro ya está hecho.
    let cartera: { asignado: boolean; motivo: string } | null = null;
    try {
      const sbCartera = await createServiceRoleClientForEmpresa(ctx.auth.empresa_id);
      cartera = await asignarCarteraPorPresupuesto(sbCartera, ctx.auth.empresa_id, id, ventaId);
    } catch (e) {
      console.warn("[marcar-convertido] cartera:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json(successResponse({ ok: true, cambios, cartera }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo marcar convertido.";
    console.error("[/api/presupuestos/[id]/marcar-convertido]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
