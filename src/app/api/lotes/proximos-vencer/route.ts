import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { diasRestantes, nivelPorDias, type NivelVencimiento } from "@/lib/lotes/nivel";

/**
 * GET /api/lotes/proximos-vencer?dias=30
 * Lista lotes activos con cantidad > 0 cuya fecha_vencimiento cae dentro de `dias`.
 * Enriquecido con producto (nombre, sku), dias_restantes y nivel.
 * Ordenado ASC por fecha_vencimiento — los más urgentes van arriba.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const url = new URL(request.url);
    const diasParam = url.searchParams.get("dias");
    let dias = Number(diasParam);
    if (!Number.isFinite(dias) || dias <= 0) dias = 30;
    dias = Math.min(Math.max(Math.floor(dias), 1), 365);

    // Cota superior de la ventana: hoy + dias.
    const hoy = new Date();
    const hasta = new Date(hoy);
    hasta.setUTCDate(hasta.getUTCDate() + dias);
    const hastaIso = hasta.toISOString().slice(0, 10);

    // Traemos los lotes activos con cantidad>0 que vencen antes de `hasta`.
    // Los vencidos (fecha_vencimiento < hoy) los incluimos: son los más críticos.
    const { data, error } = await ctx.supabase
      .from("producto_lotes")
      .select(
        "id, producto_id, numero_lote, fecha_vencimiento, cantidad, productos!inner(nombre, sku)"
      )
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("activo", true)
      .gt("cantidad", 0)
      .lte("fecha_vencimiento", hastaIso)
      .order("fecha_vencimiento", { ascending: true });

    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      producto_id: string;
      numero_lote: string;
      fecha_vencimiento: string;
      cantidad: number | string;
      productos: { nombre: string; sku: string } | { nombre: string; sku: string }[] | null;
    };

    const counts: Record<NivelVencimiento, number> = { critico: 0, proximo: 0, advertencia: 0, ok: 0 };
    const lotes = ((data ?? []) as unknown as Row[]).map((r) => {
      const prod = Array.isArray(r.productos) ? r.productos[0] : r.productos;
      const dr = diasRestantes(r.fecha_vencimiento, hoy);
      const nivel = nivelPorDias(dr);
      counts[nivel] = (counts[nivel] ?? 0) + 1;
      return {
        id: r.id,
        producto_id: r.producto_id,
        producto_nombre: prod?.nombre ?? "",
        producto_sku: prod?.sku ?? "",
        numero_lote: r.numero_lote,
        fecha_vencimiento: r.fecha_vencimiento,
        cantidad: typeof r.cantidad === "string" ? Number(r.cantidad) : r.cantidad,
        dias_restantes: dr,
        nivel,
      };
    });

    return NextResponse.json(
      successResponse({
        lotes,
        counts: {
          critico: counts.critico,
          proximo: counts.proximo,
          advertencia: counts.advertencia,
          total: lotes.length,
        },
      })
    );
  } catch (err) {
    console.error("[/api/lotes/proximos-vencer GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar los lotes próximos a vencer."),
      { status: 500 }
    );
  }
}
