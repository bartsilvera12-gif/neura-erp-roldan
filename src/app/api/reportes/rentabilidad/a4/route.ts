import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getRentabilidad } from "@/lib/reportes/server/reportes-pg";
import { resolverPeriodo } from "@/lib/reportes/periodos";
import { boundsDeRangoYmd } from "@/lib/fechas/asuncion-bounds";
import type { AgruparRentabilidad } from "@/lib/reportes/rentabilidad-types";
import { htmlUtilidadA4, TOP_PRODUCTOS } from "@/lib/reportes/server/utilidad-a4";

/**
 * GET /api/reportes/rentabilidad/a4 — utilidad del período para imprimir (10.1).
 *
 * "Utilidad por período: mensual y por rango, desglosado por rubro y grupo;
 * ventas, utilidad bruta y % de margen. Diferenciar ganancia monetaria del %
 * de margen."
 *
 * ── LAS DOS COLUMNAS QUE NO HAY QUE CONFUNDIR ──────────────────────────────
 *   La utilidad está en guaraníes y el margen en porcentaje, y van separadas
 *   porque responden preguntas distintas. Un rubro al 60% que vende poco deja
 *   menos plata que uno al 12% que vende mucho; mirando solo el porcentaje se
 *   decide al revés. La hoja agrega una tercera columna, "% de la utilidad",
 *   que es la que dice de dónde sale realmente la ganancia del mes.
 *
 * ── LAS DOS TABLAS ─────────────────────────────────────────────────────────
 *   Primero por rubro, que es la decisión gruesa. Abajo, los 30 productos que
 *   más utilidad dejan: es donde se ve qué artículo puntual sostiene el rubro,
 *   o qué artículo le arrastra el promedio.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const sp = new URL(request.url).searchParams;
    const per = resolverPeriodo(sp);
    const b = {
      ...boundsDeRangoYmd(per.actual.desde, per.actual.hasta),
      desde: per.actual.desde,
      hasta: per.actual.hasta,
    };
    const agrupar: AgruparRentabilidad = "categoria";

    const [porRubro, porProducto] = await Promise.all([
      getRentabilidad(schema, empresaId, sucursalId, b, agrupar),
      getRentabilidad(schema, empresaId, sucursalId, b, "producto"),
    ]);

    const filasRubro = [...porRubro.filas].sort((a, c) => c.ganancia - a.ganancia);
    const topProductos = [...porProducto.filas]
      .sort((a, c) => c.ganancia - a.ganancia)
      .slice(0, TOP_PRODUCTOS);

    const html = htmlUtilidadA4({
      periodoLabel: per.periodoLabel,
      desde: per.actual.desde,
      hasta: per.actual.hasta,
      totalFacturacion: porRubro.totalFacturacion,
      totalCosto: porRubro.totalCosto,
      totalGanancia: porRubro.totalGanancia,
      filasRubro,
      topProductos,
      auto: sp.get("auto") === "1",
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const sucResp = respuestaSucursalNoAsignada(err);
    if (sucResp) return sucResp;
    console.error("[/api/reportes/rentabilidad/a4]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el informe.", { status: 500 });
  }
}
