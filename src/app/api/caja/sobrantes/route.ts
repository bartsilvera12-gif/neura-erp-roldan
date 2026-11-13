import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/caja/sobrantes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Los sobrantes y faltantes de las ventas: los ajustes de caja que se
 * registran al cobrar en efectivo cuando no se da el vuelto (sobrante, +) o se
 * acepta de menos (faltante, −). Se ven en Caja como una cuenta propia, con su
 * saldo, como si fuera una caja aparte.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde");
    const hasta = sp.get("hasta");

    let q = ctx.supabase
      .from("caja_movimientos")
      .select("id, caja_id, concepto, monto, observacion, created_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("tipo", "ajuste")
      .or("concepto.ilike.Sobrante venta%,concepto.ilike.Faltante venta%")
      .order("created_at", { ascending: false })
      .limit(500);
    if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) q = q.gte("created_at", `${desde}T03:00:00Z`);
    if (hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      const d = new Date(`${hasta}T03:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      q = q.lt("created_at", d.toISOString());
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // El asiento contable de cada una (script 88), si ya se asentó.
    const ids = ((data ?? []) as Array<{ id: string }>).map((m) => m.id);
    const asientoPorMov = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 80) {
      const { data: as } = await ctx.supabase
        .from("asientos_contables")
        .select("origen_id, numero_asiento")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("origen_tipo", "caja_diferencia")
        .in("origen_id", ids.slice(i, i + 80));
      for (const a of (as ?? []) as Array<{ origen_id: string; numero_asiento: string }>) asientoPorMov.set(a.origen_id, a.numero_asiento);
    }
    const movs = ((data ?? []) as Array<{ id: string; monto: number | string }>).map((m) => ({
      ...m,
      monto: Number(m.monto) || 0,
      asiento: asientoPorMov.get(m.id) ?? null,
    }));
    const sobrantes = movs.filter((m) => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const faltantes = movs.filter((m) => m.monto < 0).reduce((s, m) => s - m.monto, 0);
    return NextResponse.json(successResponse({
      movimientos: movs,
      sobrantes,
      faltantes,
      saldo: sobrantes - faltantes,
    }));
  } catch (err) {
    console.error("[/api/caja/sobrantes]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los sobrantes y faltantes."), { status: 500 });
  }
}
