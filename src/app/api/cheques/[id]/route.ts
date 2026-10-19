import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * PATCH /api/cheques/[id] — avanza el estado de un cheque o corrige sus datos.
 *
 * El ciclo es pendiente_emision → emitido → cobrado, y desde cualquier punto
 * se puede anular. Al emitir hace falta el número; al cobrar, la fecha real de
 * cobro, que puede no coincidir con la fecha de pago proyectada.
 *
 * DELETE /api/cheques/[id] — solo si todavía no se emitió.
 */

const ESTADOS = ["pendiente_emision", "emitido", "cobrado", "anulado"] as const;
type Estado = (typeof ESTADOS)[number];

const str = (v: unknown, max = 200): string | null =>
  v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max);
const esFecha = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const hoy = () => new Date().toISOString().slice(0, 10);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const o = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    const actualQ = await ctx.supabase
      .from("cheques")
      .select("id, estado, numero, fecha_emision, importe")
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id)
      .maybeSingle();
    if (actualQ.error) throw new Error(actualQ.error.message);
    if (!actualQ.data) return NextResponse.json(errorResponse("Cheque no encontrado."), { status: 404 });
    const actual = actualQ.data as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const campo of ["numero", "banco_nombre", "observacion"] as const) {
      if (campo in o) patch[campo] = str(o[campo], campo === "observacion" ? 1000 : 200);
    }
    if ("entidad_bancaria_id" in o) patch.entidad_bancaria_id = str(o.entidad_bancaria_id, 64);
    if ("importe" in o) {
      const n = Number(o.importe);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(errorResponse("Importe inválido."), { status: 400 });
      }
      patch.importe = n;
    }
    for (const campo of ["fecha_pago_prevista", "fecha_emision", "fecha_cobro_prevista", "fecha_cobro_real"] as const) {
      if (campo in o) patch[campo] = esFecha(o[campo]);
    }

    if ("estado" in o) {
      const nuevo = String(o.estado) as Estado;
      if (!(ESTADOS as readonly string[]).includes(nuevo)) {
        return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
      }
      patch.estado = nuevo;

      // Completar lo que el estado exige, para no chocar con el CHECK de la tabla
      // y para que la planilla no quede con huecos.
      if (nuevo === "emitido" || nuevo === "cobrado") {
        const numero = (patch.numero as string | null) ?? (actual.numero as string | null);
        if (!numero) {
          return NextResponse.json(
            errorResponse("Para emitir el cheque hace falta su número."),
            { status: 400 }
          );
        }
        if (!patch.fecha_emision && !actual.fecha_emision) patch.fecha_emision = hoy();
      }
      if (nuevo === "cobrado" && !patch.fecha_cobro_real) {
        patch.fecha_cobro_real = esFecha(o.fecha_cobro_real) ?? hoy();
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay nada que actualizar."), { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("cheques").update(patch)
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id)
      .select("id, estado, numero, fecha_emision, fecha_cobro_real")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ cheque: data }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo actualizar el cheque.";
    console.error("[/api/cheques/[id] PATCH]", msg);
    if (/cheques_estado_datos_chk/.test(msg)) {
      return NextResponse.json(
        errorResponse("Faltan datos para ese estado: un cheque emitido necesita número y fecha de emisión; uno cobrado, además la fecha de cobro."),
        { status: 400 }
      );
    }
    if (/duplicate|unique/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un cheque con ese número en ese banco."), { status: 409 });
    }
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;

    const actualQ = await ctx.supabase
      .from("cheques").select("estado")
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id)
      .maybeSingle();
    if (actualQ.error) throw new Error(actualQ.error.message);
    if (!actualQ.data) return NextResponse.json(errorResponse("Cheque no encontrado."), { status: 404 });

    // Un cheque ya emitido es un documento que salió: se anula, no se borra.
    if (String((actualQ.data as { estado: string }).estado) !== "pendiente_emision") {
      return NextResponse.json(
        errorResponse("El cheque ya fue emitido: anulalo en lugar de borrarlo."),
        { status: 409 }
      );
    }

    const { error } = await ctx.supabase
      .from("cheques").delete()
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/cheques/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el cheque."), { status: 500 });
  }
}
