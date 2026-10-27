import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { creditoDe } from "@/lib/clientes/server/credito";

/**
 * GET /api/clientes/[id]/credito — cuánto puede deber este cliente, cuánto
 * debe y qué plazo tiene acordado.
 *
 * Caja lo pide al elegir el cliente. El control de verdad sigue estando al
 * registrar la venta —el saldo cambia mientras el vendedor arma el carrito—,
 * pero enterarse recién ahí es enterarse tarde: el cliente ya está esperando y
 * la venta ya está cargada. Esto es para avisar antes.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const credito = await creditoDe(ctx.supabase, ctx.auth.empresa_id, id);
    if (!credito) return NextResponse.json(errorResponse("Cliente no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ credito }));
  } catch (err) {
    console.error("[/api/clientes/[id]/credito GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo consultar el crédito del cliente."), { status: 500 });
  }
}
