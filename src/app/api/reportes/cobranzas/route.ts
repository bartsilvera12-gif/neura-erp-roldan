import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { informeCobranzas } from "@/lib/cobros/server/informe-cobranzas";

/**
 * GET /api/reportes/cobranzas — informe de cobranzas (punto 10.2).
 *
 * Filtros: cliente, desde, hasta, metodo, estado (activos|anulados|todos) y q
 * (busca en el número de factura, en la referencia del pago y en el cliente).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;

    const data = await informeCobranzas(
      ctx.supabase,
      ctx.auth.empresa_id,
      exigirSucursal(ctx.auth.sucursal_id),
      {
        clienteId: sp.get("cliente"),
        desde: sp.get("desde"),
        hasta: sp.get("hasta"),
        metodo: sp.get("metodo"),
        estado: sp.get("estado"),
        q: sp.get("q"),
      }
    );
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/cobranzas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el informe de cobranzas."), { status: 500 });
  }
}
