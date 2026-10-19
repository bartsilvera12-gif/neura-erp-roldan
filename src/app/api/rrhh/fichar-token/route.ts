import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Gestión del token público del kiosco de fichaje (admin).
 *
 *  GET  /api/rrhh/fichar-token  → token activo actual (o null si nunca se generó).
 *  POST /api/rrhh/fichar-token  → desactiva el anterior y genera uno nuevo.
 *                                  Útil si el link se filtró.
 */

function generarToken(): string {
  return randomBytes(8).toString("hex"); // 16 hex chars: corto pero no adivinable.
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const { data, error } = await supabase
      .from("fichar_tokens")
      .select("token, created_at")
      .eq("empresa_id", auth.empresa_id)
      .eq("activo", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ token: data?.token ?? null, created_at: data?.created_at ?? null }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    // Desactivar tokens anteriores (no se borran para conservar trazabilidad).
    const off = await supabase
      .from("fichar_tokens")
      .update({ activo: false })
      .eq("empresa_id", auth.empresa_id)
      .eq("activo", true);
    if (off.error) return NextResponse.json(errorResponse(off.error.message), { status: 400 });

    let token = "";
    let intento = 0;
    while (intento < 5) {
      token = generarToken();
      const ins = await supabase
        .from("fichar_tokens")
        .insert([{
          token,
          empresa_id: auth.empresa_id,
          activo: true,
          created_by: auth.usuarioCatalogId ?? null,
        }])
        .select("token, created_at")
        .single();
      if (!ins.error && ins.data) {
        return NextResponse.json(successResponse({ token: (ins.data as { token: string }).token, created_at: (ins.data as { created_at: string }).created_at }));
      }
      if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
        return NextResponse.json(errorResponse(ins.error.message), { status: 400 });
      }
      intento += 1;
    }
    return NextResponse.json(errorResponse("No se pudo generar un token único"), { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
