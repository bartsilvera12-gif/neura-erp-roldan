import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

function esAdmin(rol: string | null | undefined): boolean {
  const r = (rol ?? "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

/** GET /api/configuracion/sucursales — todas las sucursales de la empresa (activas e inactivas). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const sr = createServiceRoleClient();
    const { data, error } = await sr
      .from("sucursales")
      .select("id, codigo, nombre, es_principal, activa, establecimiento, punto_expedicion")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("es_principal", { ascending: false })
      .order("codigo");
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ sucursales: data ?? [] }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las sucursales."), { status: 500 });
  }
}

/** POST /api/configuracion/sucursales — alta. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esAdmin(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo administradores."), { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      codigo?: unknown; nombre?: unknown; establecimiento?: unknown; punto_expedicion?: unknown;
    };
    const codigo = String(body.codigo ?? "").trim().toUpperCase();
    const nombre = String(body.nombre ?? "").trim();
    const establecimiento = String(body.establecimiento ?? "").trim() || null;
    const punto_expedicion = String(body.punto_expedicion ?? "").trim() || null;
    if (!codigo || !nombre) {
      return NextResponse.json(errorResponse("Código y nombre son obligatorios."), { status: 400 });
    }
    const sr = createServiceRoleClient();
    const { data, error } = await sr
      .from("sucursales")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        codigo, nombre, establecimiento, punto_expedicion,
        es_principal: false, activa: true,
      })
      .select("id, codigo, nombre, es_principal, activa, establecimiento, punto_expedicion")
      .maybeSingle();
    if (error) {
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Ya existe una sucursal con ese código."), { status: 409 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ sucursal: data }));
  } catch (err) {
    console.error("[/api/configuracion/sucursales POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la sucursal."), { status: 500 });
  }
}
