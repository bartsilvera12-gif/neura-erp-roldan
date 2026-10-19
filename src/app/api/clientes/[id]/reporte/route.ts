import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/clientes/[id]/reporte — datos agregados del cliente.
 *  - total_facturado_12m: suma de facturas (no anuladas) últimos 365 d.
 *  - ticket_promedio_12m
 *  - cantidad_facturas_12m
 *  - dias_desde_ultima_compra
 *  - ultima_compra: { fecha, monto, factura_id, numero_factura, estado }
 *  - top_productos: [{ producto_nombre, cantidad, total }] (últimos 12m)
 *  - ranking: posicion del cliente en la cartera por monto facturado (12m)
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;
    const desde = new Date();
    desde.setDate(desde.getDate() - 365);
    const desdeIso = desde.toISOString().slice(0, 10);

    // 1) Facturas del cliente en últimos 12 meses (todas las no anuladas).
    const facsQ = await sb
      .from("facturas")
      .select("id, numero_factura, fecha, monto, estado, saldo")
      .eq("empresa_id", empresaId)
      .eq("cliente_id", id)
      .gte("fecha", desdeIso)
      .order("fecha", { ascending: false });
    if (facsQ.error) throw new Error(facsQ.error.message);
    const facsAll = (facsQ.data ?? []) as Array<{ id: string; numero_factura: string; fecha: string; monto: number; estado: string; saldo: number }>;
    const facs = facsAll.filter((f) => (f.estado ?? "").toLowerCase() !== "anulado");

    const total = facs.reduce((s, f) => s + Number(f.monto || 0), 0);
    const cantidad = facs.length;
    const ticket = cantidad > 0 ? total / cantidad : 0;
    const saldoPendiente = facs.reduce((s, f) => s + Number(f.saldo || 0), 0);
    const ultima = facs[0] ?? null;
    let diasDesdeUltima: number | null = null;
    if (ultima?.fecha) {
      const d = new Date(ultima.fecha);
      diasDesdeUltima = Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
    }

    // 2) Últimas 10 compras.
    const ultimasCompras = facs.slice(0, 10).map((f) => ({
      factura_id: f.id,
      numero_factura: f.numero_factura,
      fecha: f.fecha,
      monto: Number(f.monto || 0),
      saldo: Number(f.saldo || 0),
      estado: f.estado,
    }));

    // 3) Top 5 productos comprados en los últimos 12m — sumando factura_items.
    let topProductos: Array<{ producto_nombre: string; cantidad: number; total: number }> = [];
    if (facs.length > 0) {
      const itemsQ = await sb
        .from("factura_items")
        .select("descripcion, cantidad, total, factura_id")
        .in("factura_id", facs.map((f) => f.id))
        .eq("empresa_id", empresaId);
      if (!itemsQ.error) {
        const map = new Map<string, { cantidad: number; total: number }>();
        for (const it of (itemsQ.data ?? []) as Array<{ descripcion: string; cantidad: number; total: number }>) {
          const key = String(it.descripcion ?? "—");
          const cur = map.get(key) ?? { cantidad: 0, total: 0 };
          cur.cantidad += Number(it.cantidad || 0);
          cur.total += Number(it.total || 0);
          map.set(key, cur);
        }
        topProductos = [...map.entries()]
          .map(([producto_nombre, v]) => ({ producto_nombre, cantidad: v.cantidad, total: v.total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
      }
    }

    // 4) Ranking dentro de la cartera (por monto 12m).
    // Se calcula agregando todas las facturas de la empresa en 12m por cliente_id.
    let ranking: { posicion: number; total_clientes: number } | null = null;
    const rankQ = await sb
      .from("facturas")
      .select("cliente_id, monto, estado")
      .eq("empresa_id", empresaId)
      .gte("fecha", desdeIso);
    if (!rankQ.error) {
      const rows = (rankQ.data ?? []) as Array<{ cliente_id: string | null; monto: number; estado: string }>;
      const acc = new Map<string, number>();
      for (const r of rows) {
        if (!r.cliente_id) continue;
        if ((r.estado ?? "").toLowerCase() === "anulado") continue;
        acc.set(r.cliente_id, (acc.get(r.cliente_id) ?? 0) + Number(r.monto || 0));
      }
      const ordenado = [...acc.entries()].sort((a, b) => b[1] - a[1]);
      const idx = ordenado.findIndex(([cid]) => cid === id);
      if (idx >= 0) ranking = { posicion: idx + 1, total_clientes: ordenado.length };
    }

    return NextResponse.json(successResponse({
      total_facturado_12m: total,
      ticket_promedio_12m: ticket,
      cantidad_facturas_12m: cantidad,
      saldo_pendiente: saldoPendiente,
      dias_desde_ultima_compra: diasDesdeUltima,
      ultima_compra: ultima ? {
        factura_id: ultima.id,
        numero_factura: ultima.numero_factura,
        fecha: ultima.fecha,
        monto: Number(ultima.monto || 0),
      } : null,
      ultimas_compras: ultimasCompras,
      top_productos: topProductos,
      ranking,
    }));
  } catch (err) {
    console.error("[/api/clientes/[id]/reporte]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte del cliente."), { status: 500 });
  }
}
