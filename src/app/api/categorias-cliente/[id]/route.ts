import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** El error de PostgREST cuando falta `categorias_cliente.ajuste_pct` (script 39). */
function faltaScript39(msg: string): boolean {
  return /column .* does not exist|42703/i.test(msg) && /ajuste_pct/.test(msg);
}

function normalizarAjuste(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= -100 || n > 100) return null;
  return n;
}

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.nombre !== undefined) patch.nombre = String(body.nombre).trim();
    if (body.orden !== undefined) patch.orden = Number(body.orden) || 0;
    if (body.activa !== undefined) patch.activa = body.activa === true;

    const aplicar = (fila: Record<string, unknown>, cols: string) =>
      ctx.supabase
        .from("categorias_cliente")
        .update(fila)
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .select(cols)
        .maybeSingle();

    let r;
    if (body.ajuste_pct !== undefined) {
      r = await aplicar({ ...patch, ajuste_pct: normalizarAjuste(body.ajuste_pct) },
                        "id, nombre, orden, activa, ajuste_pct");
      if (r.error && faltaScript39(r.error.message ?? "")) {
        // Se guarda el resto y se avisa: callar el porcentaje haría creer que
        // quedó cargado.
        await aplicar(patch, "id");
        return NextResponse.json(
          errorResponse("Falta correr 39_ajuste_pct_rubro_cliente.sql para guardar el porcentaje del rubro."),
          { status: 409 }
        );
      }
    } else {
      r = await aplicar(patch, "id, nombre, orden, activa, ajuste_pct");
      if (r.error && faltaScript39(r.error.message ?? "")) {
        r = await aplicar(patch, "id, nombre, orden, activa");
      }
    }
    const { data, error } = r;
    if (error) {
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Ya existe un rubro con ese nombre."), { status: 409 });
      }
      throw new Error(error.message);
    }
    if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ categoria: data }));
  } catch (err) {
    console.error("[/api/categorias-cliente/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el rubro."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { error } = await ctx.supabase
      .from("categorias_cliente")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (error) {
      if (/23503|foreign key/i.test(error.message)) {
        return NextResponse.json(
          errorResponse("El rubro está asignado a clientes o tiene precios cargados. Desactivalo en su lugar."),
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/categorias-cliente/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el rubro."), { status: 500 });
  }
}
