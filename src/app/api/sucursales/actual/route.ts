import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * POST /api/sucursales/actual
 * Body: { sucursal_id: string }
 *
 * Cambia la sucursal activa del usuario logueado. Valida que:
 *  - La sucursal pertenece a su empresa.
 *  - El usuario tiene acceso (rol admin → sin restricción; otros → debe estar
 *    en usuario_sucursales).
 * Actualiza `usuarios.sucursal_activa_id`. El próximo request que resuelva
 * contexto va a filtrar por la nueva sucursal (helper prioriza sucursal_activa_id).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { sucursal_id?: unknown };
    const sucursalId = typeof body.sucursal_id === "string" ? body.sucursal_id.trim() : "";
    if (!sucursalId) {
      return NextResponse.json(errorResponse("Falta sucursal_id."), { status: 400 });
    }
    const usuarioCatalogId = ctx.auth.usuarioCatalogId;
    if (!usuarioCatalogId) {
      return NextResponse.json(errorResponse("Sin usuario en el catálogo."), { status: 400 });
    }
    const rol = (ctx.auth.rol ?? "").toLowerCase();
    const sr = createServiceRoleClient();

    // 1) La sucursal debe pertenecer a la empresa del usuario y estar activa.
    const { data: suc, error: sErr } = await sr
      .from("sucursales")
      .select("id, empresa_id, activa")
      .eq("id", sucursalId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!suc || (suc as { empresa_id?: string }).empresa_id !== ctx.auth.empresa_id) {
      return NextResponse.json(errorResponse("Sucursal fuera de tu empresa."), { status: 403 });
    }
    if ((suc as { activa?: boolean }).activa !== true) {
      return NextResponse.json(errorResponse("La sucursal está desactivada."), { status: 409 });
    }

    // 2) Si NO es admin, verificar que la tenga en usuario_sucursales.
    if (rol !== "admin" && rol !== "super_admin") {
      const { data: rel, error: rErr } = await sr
        .from("usuario_sucursales")
        .select("id")
        .eq("usuario_id", usuarioCatalogId)
        .eq("sucursal_id", sucursalId)
        .maybeSingle();
      if (rErr) throw new Error(rErr.message);
      if (!rel) {
        return NextResponse.json(errorResponse("No tenés acceso a esa sucursal."), { status: 403 });
      }
    }

    // 3) Update
    const { error: uErr } = await sr
      .from("usuarios")
      .update({ sucursal_activa_id: sucursalId })
      .eq("id", usuarioCatalogId);
    if (uErr) throw new Error(uErr.message);

    return NextResponse.json(successResponse({ sucursal_activa_id: sucursalId }));
  } catch (err) {
    console.error("[/api/sucursales/actual POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cambiar la sucursal."), { status: 500 });
  }
}
