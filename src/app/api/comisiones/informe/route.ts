import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { informeComisiones } from "@/lib/comisiones/server/comisiones-pg";

/**
 * GET /api/comisiones/informe — ventas, descuentos y comisiones (punto 4.6).
 *
 * Filtros: desde, hasta, vendedor, rubro.
 *
 * SOLO ADMIN. El informe muestra costos y ganancias de cada venta: es la
 * misma información que el punto 1.7 esconde al personal de mostrador, y no
 * tendría sentido protegerla en una pantalla y regalarla en otra.
 *
 * Un vendedor que quiera ver lo suyo lo ve en su hoja firmada (punto 4.2).
 */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Primer día del mes actual en Paraguay (UTC−3). */
function inicioMesPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-01`;
}

function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede ver el informe de comisiones."),
        { status: 403 }
      );
    }

    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    // Por defecto el mes en curso: es el período por el que se liquida.
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : inicioMesPy();
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : hoyPy();
    const vendedorId = (sp.get("vendedor") ?? "").trim() || null;
    const categoriaId = (sp.get("rubro") ?? "").trim() || null;

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const informe = await informeComisiones(schema, empresaId, sucursalId, {
      desde, hasta, vendedorId, categoriaId,
    });

    return NextResponse.json(successResponse({ ...informe, desde, hasta }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/comisiones/informe]", msg);
    if (/Pool no disponible/.test(msg)) {
      return NextResponse.json(
        errorResponse("No hay conexión directa a la base para calcular las comisiones."),
        { status: 503 }
      );
    }
    if (/tipos_vendedor|comisiones_reglas|comisiones_config/.test(msg) && /does not exist/.test(msg)) {
      return NextResponse.json(
        errorResponse("Falta correr 24_comisiones_cartera.sql en la base."),
        { status: 500 }
      );
    }
    return NextResponse.json(
      errorResponse("No se pudo calcular el informe de comisiones."),
      { status: 500 }
    );
  }
}
