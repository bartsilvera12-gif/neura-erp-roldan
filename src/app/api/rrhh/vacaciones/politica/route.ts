import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Política de vacaciones única por empresa. Si no existe, la de Paraguay.
 *
 * Los días los fija la ley (12/18/30 hábiles según antigüedad, ver
 * lib/rrhh/vacaciones-py.ts) y ya no salen de acá; estas columnas quedan por
 * compatibilidad. Antes el default era el de España (30 naturales, 15/15).
 * Lo único que se usa es `permitir_saldo_negativo` (adelantar vacaciones).
 */
const DEFAULTS = {
  dias_anuales: 12,
  tipo_computo: "laborables" as "naturales" | "laborables",
  proporcional_ingreso: false,
  requiere_aprobacion: false,
  permitir_saldo_negativo: false,
  arrastra_pendientes: true,
  arrastra_dias_max: null as number | null,
  pais_region: "PY" as string | null,
  dias_empresa: null as number | null,
  dias_empleado: null as number | null,
};

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("rrhh_politica_vacaciones")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ politica: data ?? { empresa_id: ctx.auth.empresa_id, ...DEFAULTS } }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PUT: upsert de política. Body completo (no parcial). Solo admin.
 */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const numn = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const payload = {
      empresa_id: ctx.auth.empresa_id,
      dias_anuales: numn(body.dias_anuales) ?? DEFAULTS.dias_anuales,
      tipo_computo: body.tipo_computo === "laborables" ? "laborables" : "naturales",
      proporcional_ingreso: body.proporcional_ingreso !== false,
      requiere_aprobacion: body.requiere_aprobacion !== false,
      permitir_saldo_negativo: body.permitir_saldo_negativo === true,
      arrastra_pendientes: body.arrastra_pendientes === true,
      arrastra_dias_max: numn(body.arrastra_dias_max),
      pais_region: typeof body.pais_region === "string" && body.pais_region.trim() !== ""
        ? body.pais_region.trim()
        : null,
      // Fase H
      dias_empresa: numn(body.dias_empresa),
      dias_empleado: numn(body.dias_empleado),
      updated_at: new Date().toISOString(),
    };

    const up = await ctx.supabase
      .from("rrhh_politica_vacaciones")
      .upsert(payload, { onConflict: "empresa_id" })
      .select()
      .single();
    if (up.error) return NextResponse.json(errorResponse(up.error.message), { status: 400 });

    return NextResponse.json(successResponse({ politica: up.data }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
