import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteCajas } from "@/lib/caja/server";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";

/**
 * GET /api/reportes/cajas?mes=YYYY-MM — cierres de caja del mes.
 *
 * `getReporteCajas` ya existía en el servidor pero no estaba expuesto por
 * ninguna ruta, así que no había forma de ver los cierres desde la app: era el
 * reporte que faltaba de la lista de Reportes.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);

    const data = await getReporteCajas(
      ctx.supabase,
      ctx.auth.empresa_id,
      {
        start,
        end,
        desde: `${mes}-01`,
        hasta: end.slice(0, 10),
      },
      ctx.auth.sucursal_id ?? null
    );
    return NextResponse.json(successResponse({ ...data, mes }));
  } catch (err) {
    console.error("[/api/reportes/cajas]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el reporte de cajas."),
      { status: 500 }
    );
  }
}
