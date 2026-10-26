import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarCobro, reversarCobro, CobroError } from "@/lib/cobros/server/cobros-pg";

/** POST /api/cobros — registra un cobro contra una cuenta por cobrar. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const usuarioNombre = ctx.auth.nombre ?? ctx.auth.user?.email ?? null;
    const usuarioId = ctx.auth.user?.id ?? null;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const result = await registrarCobro(ctx.supabase, ctx.auth.empresa_id, {
      cuenta_por_cobrar_id: String(body.cuenta_por_cobrar_id ?? ""),
      monto: Number(body.monto),
      metodo_pago: (body.metodo_pago as "efectivo" | "transferencia" | "tarjeta" | "otro") ?? "efectivo",
      entidad_bancaria_id: body.entidad_bancaria_id ? String(body.entidad_bancaria_id) : null,
      entidad_nombre_snapshot: body.entidad_nombre_snapshot ? String(body.entidad_nombre_snapshot) : null,
      referencia: body.referencia ? String(body.referencia) : null,
      titular: body.titular ? String(body.titular) : null,
      observaciones: body.observaciones ? String(body.observaciones) : null,
      fecha_pago: typeof body.fecha_pago === "string" ? body.fecha_pago : null,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      // Para atar el cobro al turno de caja abierto de esta sucursal.
      sucursal_id: ctx.auth.sucursal_id ?? null,
      usuario_email: ctx.auth.user?.email ?? null,
    });

    return NextResponse.json(successResponse(result));
  } catch (err) {
    if (err instanceof CobroError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/cobros POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el cobro."), { status: 500 });
  }
}

/**
 * DELETE /api/cobros?id=...&motivo=... — anula un cobro y devuelve el monto al
 * saldo de la cuenta.
 *
 * Sigue siendo DELETE porque es la acción que la pantalla ya llamaba, pero no
 * borra nada: el recibo queda marcado como anulado, con su motivo y su autor
 * (punto 10.3, "conservando historial"). El motivo puede venir por query o en
 * el cuerpo.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta el id del cobro."), { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo =
      (url.searchParams.get("motivo") ?? "").trim() ||
      (typeof body.motivo === "string" ? body.motivo.trim() : "");

    const result = await reversarCobro(ctx.supabase, ctx.auth.empresa_id, id, {
      motivo,
      usuarioId: ctx.auth.user?.id ?? null,
      usuarioNombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null,
      sucursalId: ctx.auth.sucursal_id ?? null,
      usuarioEmail: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse(result));
  } catch (err) {
    if (err instanceof CobroError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/cobros DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo reversar el cobro."), { status: 500 });
  }
}
