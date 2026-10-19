import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { calcularDias } from "@/lib/rrhh/vacaciones-dias";

/**
 * GET /api/rrhh/vacaciones/preview-dias?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Devuelve días calculados según la política vigente (naturales|laborables).
 * Para el indicador en vivo del form.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde") ?? "";
    const hasta = sp.get("hasta") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(successResponse({ dias: 0, tipo_computo: "naturales" }));
    }

    const forzar = sp.get("forzar");
    let tipo: "naturales" | "laborables";
    if (forzar === "laborables" || forzar === "naturales") {
      tipo = forzar;
    } else {
      const polQ = await ctx.supabase
        .from("rrhh_politica_vacaciones")
        .select("tipo_computo")
        .eq("empresa_id", ctx.auth.empresa_id)
        .maybeSingle();
      tipo =
        (polQ.data as { tipo_computo?: string } | null)?.tipo_computo === "laborables"
          ? "laborables"
          : "naturales";
    }
    const dias = calcularDias(desde, hasta, tipo);
    const dias_naturales = calcularDias(desde, hasta, "naturales");
    const dias_laborables = calcularDias(desde, hasta, "laborables");
    return NextResponse.json(successResponse({ dias, tipo_computo: tipo, dias_naturales, dias_laborables }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
