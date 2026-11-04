import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { contarDiasAusencia } from "@/lib/rrhh/server/dias-ausencia";

/**
 * GET /api/rrhh/vacaciones/preview-dias?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=vacaciones
 *
 * Los días que va a ocupar la ausencia, contados como al guardarla (ver
 * contarDiasAusencia). Para el indicador en vivo del formulario.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde") ?? "";
    const hasta = sp.get("hasta") ?? "";
    const tipo = sp.get("tipo") ?? "vacaciones";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(successResponse({ dias: 0, computo: "habiles", dias_corridos: 0 }));
    }
    const r = await contarDiasAusencia(ctx.supabase, ctx.auth.empresa_id, desde, hasta, tipo);
    return NextResponse.json(successResponse({ dias: r.dias, computo: r.computo, dias_corridos: r.corridos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
