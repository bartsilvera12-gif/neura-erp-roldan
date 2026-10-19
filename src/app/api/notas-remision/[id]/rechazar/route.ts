import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/notas-remision/[id]/rechazar
 * Body: { motivo: string }
 * Marca la NR como rechazada. No mueve stock.
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as { motivo?: string };
    const motivo = String(body.motivo ?? "").trim();
    if (!motivo) return NextResponse.json(errorResponse("Motivo obligatorio."), { status: 400 });

    const nrQ = await supabase
      .from("notas_remision")
      .select("id, numero, estado")
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (nrQ.error) throw new Error(nrQ.error.message);
    if (!nrQ.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const nr = nrQ.data as { id: string; numero: string; estado: string };
    if (nr.estado !== "pendiente") {
      return NextResponse.json(errorResponse(`NR ya está ${nr.estado}.`), { status: 409 });
    }

    const upd = await supabase
      .from("notas_remision")
      .update({ estado: "rechazada", motivo_rechazo: motivo, updated_at: new Date().toISOString() })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id);
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json(successResponse({ ok: true, numero: nr.numero }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
