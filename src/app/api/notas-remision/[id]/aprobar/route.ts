import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ajusta stock por ubicación de forma atómica-best-effort.
 * Devuelve `null` si va todo bien, mensaje si algo falla.
 */
async function ajustarStock(
  supabase: SupabaseClient,
  empresaId: string,
  ubicacionId: string,
  productoId: string,
  delta: number
): Promise<string | null> {
  const q = await supabase
    .from("inventario_stock_ubicacion")
    .select("id, stock_actual")
    .eq("empresa_id", empresaId)
    .eq("ubicacion_id", ubicacionId)
    .eq("producto_id", productoId)
    .maybeSingle();
  if (q.error) return q.error.message;
  if (q.data) {
    const nuevo = Number((q.data as { stock_actual: number }).stock_actual) + delta;
    if (nuevo < 0) return `Stock final negativo (${nuevo}) para producto ${productoId}`;
    const up = await supabase
      .from("inventario_stock_ubicacion")
      .update({ stock_actual: nuevo, updated_at: new Date().toISOString() })
      .eq("id", (q.data as { id: string }).id);
    return up.error ? up.error.message : null;
  } else {
    if (delta < 0) return `No hay fila de stock existente y el delta es negativo para producto ${productoId}`;
    const ins = await supabase
      .from("inventario_stock_ubicacion")
      .insert({ empresa_id: empresaId, ubicacion_id: ubicacionId, producto_id: productoId, stock_actual: delta });
    return ins.error ? ins.error.message : null;
  }
}

/**
 * POST /api/notas-remision/[id]/aprobar
 * Body: { aprobador: string }
 * Transfiere stock del origen al destino de forma atómica-best-effort.
 * Registra 2 movimientos_inventario (SALIDA + ENTRADA) por cada producto.
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
    const body = (await request.json().catch(() => ({}))) as { aprobador?: string };
    const aprobador = String(body.aprobador ?? "").trim();
    if (!aprobador) return NextResponse.json(errorResponse("Aprobador obligatorio."), { status: 400 });

    const nrQ = await supabase
      .from("notas_remision")
      .select("id, empresa_id, numero, estado, ubicacion_origen_id, ubicacion_destino_id")
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (nrQ.error) throw new Error(nrQ.error.message);
    if (!nrQ.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const nr = nrQ.data as { id: string; numero: string; estado: string; ubicacion_origen_id: string; ubicacion_destino_id: string };
    if (nr.estado !== "pendiente") {
      return NextResponse.json(errorResponse(`NR ya está ${nr.estado}, no se puede aprobar.`), { status: 409 });
    }
    if (nr.ubicacion_origen_id === nr.ubicacion_destino_id) {
      return NextResponse.json(errorResponse("Origen y destino no pueden ser el mismo depósito."), { status: 400 });
    }

    const itemsQ = await supabase
      .from("notas_remision_items")
      .select("producto_id, cantidad")
      .eq("nota_remision_id", id);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    const items = (itemsQ.data ?? []) as Array<{ producto_id: string; cantidad: number }>;
    if (items.length === 0) return NextResponse.json(errorResponse("NR sin items."), { status: 400 });

    // Validar stock disponible antes de descontar
    const stockOrigenQ = await supabase
      .from("inventario_stock_ubicacion")
      .select("producto_id, stock_actual")
      .eq("empresa_id", auth.empresa_id)
      .eq("ubicacion_id", nr.ubicacion_origen_id)
      .in("producto_id", items.map((i) => i.producto_id));
    if (stockOrigenQ.error) throw new Error(stockOrigenQ.error.message);
    const stockOrig = new Map<string, number>();
    for (const s of (stockOrigenQ.data ?? []) as Array<{ producto_id: string; stock_actual: number }>) {
      stockOrig.set(s.producto_id, Number(s.stock_actual));
    }

    // Info producto (nombre, sku) para movimientos
    const prodQ = await supabase
      .from("productos")
      .select("id, nombre, sku")
      .eq("empresa_id", auth.empresa_id)
      .in("id", items.map((i) => i.producto_id));
    if (prodQ.error) throw new Error(prodQ.error.message);
    const prodInfo = new Map<string, { nombre: string; sku: string }>();
    for (const p of (prodQ.data ?? []) as Array<{ id: string; nombre: string; sku: string | null }>) {
      prodInfo.set(p.id, { nombre: p.nombre, sku: p.sku ?? "" });
    }

    for (const it of items) {
      const disp = stockOrig.get(it.producto_id) ?? 0;
      if (Number(it.cantidad) > disp) {
        const info = prodInfo.get(it.producto_id);
        return NextResponse.json(errorResponse(`Stock insuficiente de ${info?.nombre ?? it.producto_id} en origen: hay ${disp}, se piden ${it.cantidad}.`), { status: 400 });
      }
    }

    // Aplicar transferencia con tracking para revertir si algún ítem falla.
    const nowIso = new Date().toISOString();
    const errores: string[] = [];
    // aplicados: [productoId, ubicacionId, deltaAplicado] — para revertir todo si algo falla.
    const aplicados: Array<{ producto_id: string; ubicacion_id: string; delta: number }> = [];
    for (const it of items) {
      const cant = Number(it.cantidad);
      const e1 = await ajustarStock(supabase, auth.empresa_id, nr.ubicacion_origen_id, it.producto_id, -cant);
      if (e1) { errores.push(`SALIDA ${it.producto_id}: ${e1}`); break; }
      aplicados.push({ producto_id: it.producto_id, ubicacion_id: nr.ubicacion_origen_id, delta: -cant });
      const e2 = await ajustarStock(supabase, auth.empresa_id, nr.ubicacion_destino_id, it.producto_id, cant);
      if (e2) { errores.push(`ENTRADA ${it.producto_id}: ${e2}`); break; }
      aplicados.push({ producto_id: it.producto_id, ubicacion_id: nr.ubicacion_destino_id, delta: cant });

      const info = prodInfo.get(it.producto_id);
      const movs = [
        {
          empresa_id: auth.empresa_id,
          producto_id: it.producto_id,
          producto_nombre: info?.nombre ?? "?",
          producto_sku: info?.sku ?? null,
          tipo: "SALIDA",
          cantidad: cant,
          costo_unitario: 0,
          origen: "nota_remision",
          referencia: nr.numero,
          fecha: nowIso,
          ubicacion_id: nr.ubicacion_origen_id,
        },
        {
          empresa_id: auth.empresa_id,
          producto_id: it.producto_id,
          producto_nombre: info?.nombre ?? "?",
          producto_sku: info?.sku ?? null,
          tipo: "ENTRADA",
          cantidad: cant,
          costo_unitario: 0,
          origen: "nota_remision",
          referencia: nr.numero,
          fecha: nowIso,
          ubicacion_id: nr.ubicacion_destino_id,
        },
      ];
      const movIns = await supabase.from("movimientos_inventario").insert(movs);
      if (movIns.error) {
        // Log warning pero no bloquear si es CHECK constraint
        console.warn(`[NR aprobar] movimiento falló: ${movIns.error.message}`);
      }
    }

    if (errores.length > 0) {
      // Revertir todos los ajustes aplicados (mejor esfuerzo) y borrar movimientos parciales.
      for (const a of aplicados.slice().reverse()) {
        await ajustarStock(supabase, auth.empresa_id, a.ubicacion_id, a.producto_id, -a.delta).catch(() => null);
      }
      try {
        await supabase.from("movimientos_inventario")
          .delete()
          .eq("empresa_id", auth.empresa_id)
          .eq("referencia", nr.numero)
          .eq("origen", "nota_remision");
      } catch {}
      return NextResponse.json(errorResponse(`Errores parciales: ${errores.join(" | ")}. La NR queda en pendiente.`), { status: 500 });
    }

    // Marcar aprobada
    const upd = await supabase
      .from("notas_remision")
      .update({ estado: "aprobada", aprobada_at: nowIso, aprobada_por: aprobador, updated_at: nowIso })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id);
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json(successResponse({ ok: true, numero: nr.numero }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
