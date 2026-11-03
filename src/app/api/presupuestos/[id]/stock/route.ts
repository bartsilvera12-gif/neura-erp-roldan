import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { faltantesParaFacturar, mensajeNoFacturable } from "@/lib/presupuestos/server/stock-presupuesto";

/**
 * GET /api/presupuestos/[id]/stock — ¿alcanza para cobrarlo?
 *
 * La misma cuenta que bloquea el envío a caja, pero para que la pantalla de
 * cobro pueda decirlo ANTES de que el cajero termine de cobrar. El presupuesto
 * pudo haberse mandado a la caja ayer y la mercadería haberse vendido hoy por
 * mostrador: lo que valía al mandarlo no vale necesariamente al cobrarlo.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const faltantes = await faltantesParaFacturar(
      ctx.supabase,
      ctx.auth.empresa_id,
      ctx.auth.sucursal_id ?? null,
      id
    );

    return NextResponse.json(successResponse({
      facturable: faltantes.length === 0,
      faltantes,
      aviso: faltantes.length > 0 ? mensajeNoFacturable(faltantes) : null,
    }));
  } catch (err) {
    console.error("[/api/presupuestos/[id]/stock GET]", err instanceof Error ? err.message : err);
    // Sin el dato no se bloquea nada: frenar un cobro por un problema nuestro
    // es peor que dejarlo pasar, y el envío a caja ya lo había validado.
    return NextResponse.json(successResponse({ facturable: true, faltantes: [], aviso: null }));
  }
}
