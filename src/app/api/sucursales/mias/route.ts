import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * GET /api/sucursales/mias
 *
 * Devuelve las sucursales a las que el usuario logueado tiene acceso.
 *  - Rol `admin`: todas las sucursales activas de su empresa.
 *  - Otros roles: solo las que están asignadas en `usuario_sucursales`.
 * Además retorna `sucursal_activa_id` (la que está usando ahora) para que
 * el switcher del header sepa cuál marcar como seleccionada.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const rol = (ctx.auth.rol ?? "").toLowerCase();
    const sr = createServiceRoleClient();

    let sucursales: unknown[] = [];
    if (rol === "admin" || rol === "super_admin") {
      const { data, error } = await sr
        .from("sucursales")
        .select("id, codigo, nombre, es_principal")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("activa", true)
        .order("es_principal", { ascending: false })
        .order("nombre");
      if (error) throw new Error(error.message);
      sucursales = data ?? [];
    } else {
      // Solo las asignadas en usuario_sucursales
      const { data, error } = await sr
        .from("usuario_sucursales")
        .select("sucursal_id, es_default, sucursales:sucursal_id(id, codigo, nombre, es_principal, activa, empresa_id)")
        .eq("usuario_id", ctx.auth.usuarioCatalogId ?? "");
      if (error) throw new Error(error.message);
      sucursales = (data ?? [])
        .map((r) => {
          const s = (r as { sucursales: unknown }).sucursales;
          return Array.isArray(s) ? s[0] : s;
        })
        .filter((s): s is { id: string; codigo: string; nombre: string; es_principal: boolean; activa: boolean; empresa_id: string } =>
          !!s && typeof s === "object" && (s as { activa?: boolean }).activa === true
        )
        .map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre, es_principal: s.es_principal }));
    }

    // Sucursal activa actual
    const { data: usuarioRow } = await sr
      .from("usuarios")
      .select("sucursal_activa_id")
      .eq("id", ctx.auth.usuarioCatalogId ?? "")
      .maybeSingle();
    const sucursal_activa_id = (usuarioRow as { sucursal_activa_id?: string | null } | null)?.sucursal_activa_id ?? null;

    return NextResponse.json(successResponse({ sucursales, sucursal_activa_id }));
  } catch (err) {
    console.error("[/api/sucursales/mias GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las sucursales."), { status: 500 });
  }
}
