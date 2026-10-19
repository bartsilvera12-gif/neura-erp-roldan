import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";

async function gateEditar(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return { err: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) } as const;
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  if (!puede(perms, "salarios.editar")) {
    return { err: NextResponse.json(errorResponse("Sin permiso para editar salarios"), { status: 403 }) } as const;
  }
  return { ctx } as const;
}

/** PATCH edición parcial del tramo salarial. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; salarioId: string }> }) {
  const g = await gateEditar(request);
  if ("err" in g) return g.err;
  const { id, salarioId } = await params;
  if (!id || !salarioId) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const numFields = ["salario_bruto","salario_neto","plus_peligrosidad","plus_prl","coste_empresa"];
  for (const k of numFields) {
    if (body[k] !== undefined) {
      if (body[k] === null || body[k] === "") update[k] = null;
      else { const n = Number(body[k]); update[k] = Number.isFinite(n) ? n : null; }
    }
  }
  if (body.fecha_vigencia_desde !== undefined) update.fecha_vigencia_desde = String(body.fecha_vigencia_desde);
  if (body.fecha_vigencia_hasta !== undefined) update.fecha_vigencia_hasta = body.fecha_vigencia_hasta ? String(body.fecha_vigencia_hasta) : null;
  if (body.moneda !== undefined) update.moneda = String(body.moneda ?? "PYG");
  if (body.observaciones !== undefined) update.observaciones = body.observaciones ? String(body.observaciones).trim() || null : null;
  if (body.otros_pluses !== undefined && typeof body.otros_pluses === "object") update.otros_pluses = body.otros_pluses;
  if (body.deducciones !== undefined && typeof body.deducciones === "object") update.deducciones = body.deducciones;

  const { error } = await g.ctx.supabase
    .from("empleado_salarios")
    .update(update)
    .eq("id", salarioId)
    .eq("empleado_id", id)
    .eq("empresa_id", g.ctx.auth.empresa_id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ ok: true }));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; salarioId: string }> }) {
  const g = await gateEditar(request);
  if ("err" in g) return g.err;
  const { id, salarioId } = await params;
  const { error } = await g.ctx.supabase
    .from("empleado_salarios")
    .delete()
    .eq("id", salarioId)
    .eq("empleado_id", id)
    .eq("empresa_id", g.ctx.auth.empresa_id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ ok: true }));
}
