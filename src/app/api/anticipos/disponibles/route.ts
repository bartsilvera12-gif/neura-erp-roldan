import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { saldoDeCliente } from "@/lib/anticipos/server/aplicar";

/**
 * GET /api/anticipos/disponibles?cliente=<id>
 *
 * Cuánto tiene a favor un cliente en esta sucursal. Lo llama Caja cuando el
 * cajero elige el cliente: la pregunta del mostrador es "¿este señor dejó
 * algo a cuenta?", y hasta ahora había que ir a otra pantalla a buscarlo.
 *
 * Devuelve saldo 0 y un aviso —no un error— si todavía no se corrió el
 * script 50: la venta tiene que poder cobrarse igual.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const clienteId = (new URL(request.url).searchParams.get("cliente") ?? "").trim();

    if (!clienteId) {
      return NextResponse.json(successResponse({ saldo: 0, anticipos: [], aviso: null }));
    }

    const r = await saldoDeCliente(ctx.supabase, ctx.auth.empresa_id, sucursalId, clienteId);
    return NextResponse.json(successResponse(r));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/anticipos/disponibles]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo consultar el anticipo del cliente."),
      { status: 500 }
    );
  }
}
