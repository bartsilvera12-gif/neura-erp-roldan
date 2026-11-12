import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { faltantesDeStock, mensajeFaltantes } from "@/lib/presupuestos/server/stock-presupuesto";

/**
 * POST   /api/presupuestos/[id]/reserva — reserva la mercadería del presupuesto.
 *        Lo puede hacer cualquiera. No se puede reservar más de lo que está
 *        libre (stock − lo ya reservado en otros presupuestos).
 * DELETE /api/presupuestos/[id]/reserva — quita la reserva. Solo un administrador.
 *
 * Mientras está reservado, su mercadería no se puede cotizar en otro
 * presupuesto (ver `reservasPorProducto`). Script 86.
 */

const faltaScript86 = (m: string) => /reservado/.test(m) && /does not exist|42703|schema cache/i.test(m);
const AVISO_86 = "Falta correr el script 86: la base todavía no tiene dónde guardar la reserva.";

async function cargar(request: NextRequest, id: string) {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return { error: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) } as const;
  const r = await ctx.supabase
    .from("presupuestos")
    .select("id, estado, convertido_venta_id, reservado")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (r.error) {
    if (faltaScript86(r.error.message)) return { error: NextResponse.json(errorResponse(AVISO_86), { status: 503 }) } as const;
    return { error: NextResponse.json(errorResponse(r.error.message), { status: 500 }) } as const;
  }
  if (!r.data) return { error: NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 }) } as const;
  return { ctx, presu: r.data as { estado?: string; convertido_venta_id?: string | null; reservado?: boolean } } as const;
}

/** GET — si está reservado, quién y cuándo, y si quien mira puede quitar la reserva. */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const r = await ctx.supabase
    .from("presupuestos")
    .select("reservado, reservado_at, reservado_por")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (r.error) {
    // Sin el script 86: no hay reservas, y se dice por qué.
    return NextResponse.json(successResponse({ disponible: false, aviso: AVISO_86, reservado: false, puede_quitar: false }));
  }
  const d = (r.data ?? {}) as { reservado?: boolean; reservado_at?: string | null; reservado_por?: string | null };
  return NextResponse.json(successResponse({
    disponible: true,
    reservado: d.reservado === true,
    reservado_at: d.reservado_at ?? null,
    reservado_por: d.reservado_por ?? null,
    puede_quitar: isAdmin(ctx.auth),
  }));
}

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const res = await cargar(request, id);
    if ("error" in res) return res.error;
    const { ctx, presu } = res;

    if (presu.convertido_venta_id || presu.estado === "convertido") {
      return NextResponse.json(errorResponse("Ya se cobró: la mercadería ya salió del stock."), { status: 409 });
    }
    if (presu.estado === "rechazado" || presu.estado === "anulado") {
      return NextResponse.json(errorResponse(`Está ${presu.estado}: no tiene sentido reservar.`), { status: 409 });
    }
    if (presu.reservado) return NextResponse.json(successResponse({ reservado: true }));

    // No se puede reservar lo que ya está reservado por otro: se mide contra
    // lo libre, sin contar este mismo presupuesto.
    const it = await ctx.supabase
      .from("presupuesto_items")
      .select("producto_id, producto_nombre, cantidad")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id);
    if (it.error) throw new Error(it.error.message);
    const faltan = await faltantesDeStock(
      ctx.supabase,
      ctx.auth.empresa_id,
      ctx.auth.sucursal_id ?? null,
      ((it.data ?? []) as Array<{ producto_id: string | null; producto_nombre: string; cantidad: number }>).map((l) => ({
        producto_id: l.producto_id,
        producto_nombre: l.producto_nombre,
        cantidad: Number(l.cantidad) || 0,
      })),
      id
    );
    if (faltan.length > 0) {
      return NextResponse.json(
        errorResponse(`No se puede reservar: ${mensajeFaltantes(faltan)}`),
        { status: 409 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const up = await ctx.supabase
      .from("presupuestos")
      .update({ reservado: true, reservado_at: new Date().toISOString(), reservado_por: firma.nombre ?? null })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (up.error) {
      if (faltaScript86(up.error.message)) return NextResponse.json(errorResponse(AVISO_86), { status: 503 });
      throw new Error(up.error.message);
    }
    return NextResponse.json(successResponse({ reservado: true }));
  } catch (err) {
    console.error("[/api/presupuestos/[id]/reserva POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo reservar."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const res = await cargar(request, id);
    if ("error" in res) return res.error;
    const { ctx } = res;
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo un administrador puede quitar una reserva."), { status: 403 });
    }
    const up = await ctx.supabase
      .from("presupuestos")
      .update({ reservado: false, reservado_at: null, reservado_por: null })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (up.error) throw new Error(up.error.message);
    return NextResponse.json(successResponse({ reservado: false }));
  } catch (err) {
    console.error("[/api/presupuestos/[id]/reserva DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar la reserva."), { status: 500 });
  }
}
