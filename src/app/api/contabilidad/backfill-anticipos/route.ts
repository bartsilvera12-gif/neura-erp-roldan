import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/contabilidad/backfill-anticipos — [DAROCHA] no implementado.
 *
 * En sistemas-propio esta ruta reclasifica anticipos de cobranzas (Debe
 * Anticipos / Haber Clientes) llamando a `sweepReclasificarAnticipos` en
 * `lib/cobranzas/conciliacion-pg`. Ese módulo no fue portado a Darocha (el
 * módulo de cobranzas/conciliación no existe todavía), así que la ruta
 * responde 501 hasta que se porte el flujo de anticipos.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  return NextResponse.json(
    errorResponse("Backfill de anticipos no disponible: el módulo de cobranzas/conciliación aún no está portado a Darocha."),
    { status: 501 }
  );
}
