import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * PATCH /api/anticipos/[id] — anular o marcar como utilizado (punto 5.6).
 *
 * ANULAR REQUIERE MOTIVO Y ADMIN
 *   Un anticipo anulado es plata que el cliente dejó y que deja de estar a su
 *   favor. Si desaparece sin explicación, el reclamo llega igual pero sin nada
 *   escrito con qué contestarlo.
 *
 * NO SE BORRA, SE ANULA
 *   El registro queda con su número, su monto y el motivo. Borrarlo haría
 *   desaparecer de los arqueos viejos una plata que sí entró ese día.
 */

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id } = await context.params;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accion = String(b.accion ?? "");

    const aQ = await ctx.supabase
      .from("anticipos")
      .select("id, numero, estado, monto, cliente_nombre")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .eq("id", id)
      .maybeSingle();
    if (aQ.error) {
      if (/anticipos/.test(aQ.error.message) && /does not exist|schema cache|PGRST205/i.test(aQ.error.message)) {
        return NextResponse.json(errorResponse("Falta correr 25_caja_modulo5.sql en la base."), { status: 500 });
      }
      throw new Error(aQ.error.message);
    }
    if (!aQ.data) return NextResponse.json(errorResponse("Anticipo no encontrado."), { status: 404 });
    const anticipo = aQ.data as { numero: string | null; estado: string };

    if (accion === "anular") {
      if (!isAdmin(ctx.auth)) {
        return NextResponse.json(
          errorResponse("Solo un administrador puede anular un anticipo."),
          { status: 403 }
        );
      }
      if (anticipo.estado === "anulado") {
        return NextResponse.json(errorResponse("Ese anticipo ya está anulado."), { status: 409 });
      }
      if (anticipo.estado === "utilizado") {
        return NextResponse.json(
          errorResponse("Ese anticipo ya se aplicó a una venta. Para revertirlo hay que tocar la venta, no el anticipo."),
          { status: 409 }
        );
      }
      const motivo = String(b.motivo ?? "").trim();
      if (!motivo) {
        return NextResponse.json(errorResponse("Escribí el motivo de la anulación."), { status: 400 });
      }

      const firma = await firmaUsuario(ctx.supabase, ctx.auth);
      const upd = await ctx.supabase
        .from("anticipos")
        .update({
          estado: "anulado",
          anulado_at: new Date().toISOString(),
          anulado_por: firma.nombre,
          anulado_motivo: motivo,
          updated_at: new Date().toISOString(),
        })
        .eq("empresa_id", empresaId).eq("id", id)
        .eq("estado", "activo");
      if (upd.error) throw new Error(upd.error.message);
      return NextResponse.json(successResponse({ ok: true, numero: anticipo.numero }));
    }

    if (accion === "utilizar") {
      if (anticipo.estado !== "activo") {
        return NextResponse.json(
          errorResponse(`Ese anticipo está ${anticipo.estado}, no se puede aplicar.`),
          { status: 409 }
        );
      }
      const ventaId = typeof b.venta_id === "string" && b.venta_id.trim() ? b.venta_id.trim() : null;
      const upd = await ctx.supabase
        .from("anticipos")
        .update({
          estado: "utilizado",
          venta_id: ventaId,
          updated_at: new Date().toISOString(),
        })
        .eq("empresa_id", empresaId).eq("id", id)
        .eq("estado", "activo");
      if (upd.error) throw new Error(upd.error.message);
      return NextResponse.json(successResponse({ ok: true, numero: anticipo.numero }));
    }

    return NextResponse.json(errorResponse("Acción desconocida."), { status: 400 });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/anticipos/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el anticipo."), { status: 500 });
  }
}
