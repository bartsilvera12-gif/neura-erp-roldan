import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * POST /api/presupuestos/[id]/enviar-a-caja
 *
 * El vendedor aprueba el presupuesto y lo manda a cobrar. Al cajero le
 * aparece en la lista de pendientes, sin tener que avisarle de palabra ni
 * caminar hasta la caja.
 *
 * No hace falta ser administrador: mandar a cobrar lo que uno mismo cerró es
 * parte de vender. Lo que sí se exige es que esté aprobado y sin cobrar.
 *
 * DELETE da marcha atrás, para el presupuesto que se mandó por error.
 */
async function resolver(request: NextRequest, id: string) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return { error: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) };

  const r = await ctx.supabase
    .from("presupuestos")
    .select("id, estado, convertido_venta_id")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (r.error) return { error: NextResponse.json(errorResponse(r.error.message), { status: 500 }) };
  if (!r.data) return { error: NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 }) };
  return { ctx, presu: r.data as { estado?: string; convertido_venta_id?: string | null } };
}

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const res = await resolver(request, id);
    if ("error" in res) return res.error;
    const { ctx, presu } = res;

    if (presu.estado !== "aprobado") {
      return NextResponse.json(
        errorResponse("Solo se manda a cobrar un presupuesto aprobado."),
        { status: 409 }
      );
    }
    if (presu.convertido_venta_id) {
      return NextResponse.json(errorResponse("Este presupuesto ya se cobró."), { status: 409 });
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const upd = await ctx.supabase
      .from("presupuestos")
      .update({
        enviado_a_caja_at: new Date().toISOString(),
        enviado_a_caja_por: firma.nombre,
      })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (upd.error) {
      // Sin el script 42 no existen las columnas. Se dice con todas las
      // letras en vez de fingir que se mandó: el cajero no lo va a ver.
      if (/enviado_a_caja/.test(upd.error.message)) {
        return NextResponse.json(
          errorResponse("Falta correr 42_presupuesto_a_caja.sql para mandar presupuestos a la caja."),
          { status: 409 }
        );
      }
      throw new Error(upd.error.message);
    }
    return NextResponse.json(successResponse({ ok: true, enviado_por: firma.nombre }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo mandar a la caja.";
    console.error("[/api/presupuestos/[id]/enviar-a-caja POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const res = await resolver(request, id);
    if ("error" in res) return res.error;
    const { ctx } = res;

    const upd = await ctx.supabase
      .from("presupuestos")
      .update({ enviado_a_caja_at: null, enviado_a_caja_por: null })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (upd.error && !/enviado_a_caja/.test(upd.error.message)) throw new Error(upd.error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo sacar de la caja.";
    console.error("[/api/presupuestos/[id]/enviar-a-caja DELETE]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
