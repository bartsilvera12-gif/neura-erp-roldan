import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";

/**
 * POST /api/ventas/[id]/vendedor — cambia el vendedor de una venta.
 *
 * Pedido del cliente («que se pueda editar el vendedor»). Solo un
 * administrador: el vendedor de la venta (`vendedor_usuario_id`) es a quién
 * se le paga la comisión. No toca la cartera del cliente, ni la factura, ni
 * los totales.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Cambiar el vendedor de una venta lo hace un administrador."), { status: 403 });
    }
    const empresaId = ctx.auth.empresa_id;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const vendedorId = typeof b.vendedor_usuario_id === "string" ? b.vendedor_usuario_id.trim() : "";
    if (!vendedorId) {
      return NextResponse.json(errorResponse("Elegí el vendedor."), { status: 400 });
    }

    const u = await ctx.supabase
      .from("usuarios")
      .select("id, nombre, email")
      .eq("empresa_id", empresaId)
      .eq("id", vendedorId)
      .maybeSingle();
    if (u.error || !u.data) {
      return NextResponse.json(errorResponse("Ese usuario no existe en la empresa."), { status: 400 });
    }
    const usr = u.data as { id: string; nombre: string | null; email: string | null };
    const nombre = (usr.nombre ?? "").trim() || usr.email || "Usuario";

    const up = await ctx.supabase
      .from("ventas")
      .update({ vendedor_usuario_id: usr.id, vendedor_nombre: nombre })
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select("id");
    if (up.error) {
      return NextResponse.json(errorResponse(`No se pudo cambiar el vendedor: ${up.error.message}`), { status: 500 });
    }
    if (!up.data || up.data.length === 0) {
      return NextResponse.json(errorResponse("No se encontró la venta."), { status: 404 });
    }
    return NextResponse.json(successResponse({ vendedor_usuario_id: usr.id, vendedor_nombre: nombre }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(errorResponse(`No se pudo cambiar el vendedor: ${msg}`), { status: 500 });
  }
}
