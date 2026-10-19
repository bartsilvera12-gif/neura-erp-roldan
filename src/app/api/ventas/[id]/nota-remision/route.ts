import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

/**
 * GET/PATCH /api/ventas/[id]/nota-remision
 *
 * Datos de la Nota de Remisión (documento NO fiscal) asociados a una venta:
 * chofer (nombre, CI, teléfono) y transporte (marca, chapa, color).
 * PATCH también marca `genera_nota_remision = true` y asigna un número
 * NR-XXXXXX si la venta todavía no tenía uno.
 */

export const dynamic = "force-dynamic";

const NR_COLS =
  "nr_chofer_nombre, nr_chofer_ci, nr_chofer_telefono, " +
  "nr_transporte_marca, nr_transporte_chapa, nr_transporte_color, " +
  "genera_nota_remision, nota_remision_numero";

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });

    const q = await ctx.supabase
      .from("ventas")
      .select(NR_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (q.error) throw new Error(q.error.message);
    if (!q.data) return NextResponse.json({ success: false, error: "Venta no encontrada" }, { status: 404 });

    return NextResponse.json({ success: true, data: q.data });
  } catch (err) {
    console.error("[/api/ventas/[id]/nota-remision GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "No se pudo cargar la nota de remisión." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: "JSON inválido" }, { status: 400 });
    }

    // Estado actual (para saber si ya tiene número asignado).
    const cur = await ctx.supabase
      .from("ventas")
      .select("nota_remision_numero")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json({ success: false, error: "Venta no encontrada" }, { status: 404 });

    const numeroActual = (cur.data as { nota_remision_numero: string | null }).nota_remision_numero;

    // Asignar próximo NR-XXXXXX solo si la venta no tenía número (documento no
    // fiscal, numeración simple por empresa).
    let numero = numeroActual;
    if (!numero) {
      const prev = await ctx.supabase
        .from("ventas")
        .select("nota_remision_numero")
        .eq("empresa_id", empresaId)
        .not("nota_remision_numero", "is", null);
      const rows = (prev.data ?? []) as Array<{ nota_remision_numero: string | null }>;
      let max = 0;
      for (const r of rows) {
        const m = /(\d+)\s*$/.exec(String(r.nota_remision_numero ?? ""));
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
      }
      numero = `NR-${String(max + 1).padStart(6, "0")}`;
    }

    const update: Record<string, unknown> = {
      nr_chofer_nombre: s(body.chofer_nombre),
      nr_chofer_ci: s(body.chofer_ci),
      nr_chofer_telefono: s(body.chofer_telefono),
      nr_transporte_marca: s(body.transporte_marca),
      nr_transporte_chapa: s(body.transporte_chapa),
      nr_transporte_color: s(body.transporte_color),
      genera_nota_remision: true,
      nota_remision_numero: numero,
    };

    const upd = await ctx.supabase
      .from("ventas")
      .update(update)
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select(NR_COLS)
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json({ success: true, data: upd.data });
  } catch (err) {
    console.error("[/api/ventas/[id]/nota-remision PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "No se pudo guardar la nota de remisión." }, { status: 500 });
  }
}
