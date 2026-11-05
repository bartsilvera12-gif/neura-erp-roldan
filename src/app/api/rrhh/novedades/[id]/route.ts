import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";
import { AVISO_76, faltaScript76 } from "@/lib/rrhh/novedades";

/**
 * PATCH /api/rrhh/novedades/[id]
 *   { firmada: true|false }            — el empleado firmó (o no) la notificación.
 *   { anular: true, motivo: "..." }    — se anula con su motivo. No se borra:
 *                                        el historial no se limpia a escondidas.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  if (!puede(perms, "empleados.editar")) {
    return NextResponse.json(errorResponse("No tenés permiso para esto."), { status: 403 });
  }
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ahora = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: ahora };

  if (b.anular === true) {
    const motivo = typeof b.motivo === "string" ? b.motivo.trim().slice(0, 300) : "";
    if (!motivo) return NextResponse.json(errorResponse("Escribí por qué se anula."), { status: 400 });
    patch.estado = "anulada";
    patch.motivo_anulacion = motivo;
  } else if (typeof b.firmada === "boolean") {
    patch.firmada_at = b.firmada ? ahora : null;
  } else {
    return NextResponse.json(errorResponse("Nada para cambiar."), { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("empleado_novedades")
    .update(patch)
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    if (faltaScript76(error.message)) return NextResponse.json(errorResponse(AVISO_76), { status: 503 });
    return NextResponse.json(errorResponse(error.message), { status: 400 });
  }
  if (!data) return NextResponse.json(errorResponse("No encontrada."), { status: 404 });
  return NextResponse.json(successResponse({ novedad: data }));
}
