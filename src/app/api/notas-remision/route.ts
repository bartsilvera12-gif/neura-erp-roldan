import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const COLS =
  "id, empresa_id, numero, fecha, emisor, ubicacion_origen_id, ubicacion_destino_id, motivo, estado, motivo_rechazo, aprobada_at, aprobada_por, transportista, ruc_transportista, conductor, ci_conductor, chapa, fecha_inicio_traslado, fecha_fin_traslado, observaciones, created_at, updated_at";

type ItemIn = { producto_id: string; cantidad: number };

/**
 * GET /api/notas-remision — lista con filtros (?estado, ?origen, ?destino, ?buscar).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const { searchParams } = new URL(request.url);

    let q = supabase
      .from("notas_remision")
      .select(COLS)
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });

    const estado = searchParams.get("estado");
    if (estado) q = q.eq("estado", estado);
    const origen = searchParams.get("origen");
    if (origen) q = q.eq("ubicacion_origen_id", origen);
    const destino = searchParams.get("destino");
    if (destino) q = q.eq("ubicacion_destino_id", destino);
    const buscar = (searchParams.get("buscar") ?? "").trim();
    if (buscar) q = q.or(`numero.ilike.%${buscar}%,emisor.ilike.%${buscar}%`);

    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const nrs = (data ?? []) as Array<Record<string, unknown>>;
    if (nrs.length === 0) return NextResponse.json(successResponse({ notas_remision: [] }));

    const ids = nrs.map((r) => String(r.id));
    const itemsQ = await supabase
      .from("notas_remision_items")
      .select("nota_remision_id, producto_id, cantidad")
      .in("nota_remision_id", ids);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    const itemsByNr = new Map<string, Array<{ producto_id: string; cantidad: number }>>();
    for (const it of (itemsQ.data ?? []) as Array<{ nota_remision_id: string; producto_id: string; cantidad: number }>) {
      const arr = itemsByNr.get(it.nota_remision_id) ?? [];
      arr.push({ producto_id: it.producto_id, cantidad: Number(it.cantidad) });
      itemsByNr.set(it.nota_remision_id, arr);
    }

    const notas_remision = nrs.map((r) => ({
      ...r,
      items: itemsByNr.get(String(r.id)) ?? [],
    }));

    return NextResponse.json(successResponse({ notas_remision }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

/**
 * POST /api/notas-remision — crear NR en estado 'pendiente'.
 * No mueve stock (eso pasa al aprobar).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as {
      emisor?: string;
      ubicacion_origen_id?: string;
      ubicacion_destino_id?: string;
      motivo?: "traslado" | "venta" | "devolucion";
      items?: ItemIn[];
      transportista?: string;
      ruc_transportista?: string;
      conductor?: string;
      ci_conductor?: string;
      chapa?: string;
      fecha_inicio_traslado?: string;
      fecha_fin_traslado?: string;
      observaciones?: string;
    };

    const emisor = String(body.emisor ?? "").trim();
    const origenId = String(body.ubicacion_origen_id ?? "").trim();
    const destinoId = String(body.ubicacion_destino_id ?? "").trim();
    const motivo = ["traslado", "venta", "devolucion"].includes(String(body.motivo)) ? body.motivo! : "traslado";
    if (!emisor) return NextResponse.json(errorResponse("Emisor obligatorio."), { status: 400 });
    if (!origenId || !destinoId) return NextResponse.json(errorResponse("Origen y destino obligatorios."), { status: 400 });
    if (origenId === destinoId) return NextResponse.json(errorResponse("Origen y destino no pueden ser iguales."), { status: 400 });
    const items = (body.items ?? []).filter((i) => i && i.producto_id && Number(i.cantidad) > 0);
    if (items.length === 0) return NextResponse.json(errorResponse("Cargá al menos 1 producto con cantidad > 0."), { status: 400 });

    // Validar ubicaciones
    const ubQ = await supabase
      .from("inventario_ubicaciones")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .in("id", [origenId, destinoId]);
    if (ubQ.error) throw new Error(ubQ.error.message);
    if ((ubQ.data ?? []).length !== 2) return NextResponse.json(errorResponse("Ubicación inválida."), { status: 400 });

    // Validar stock disponible en origen
    const productoIds = Array.from(new Set(items.map((i) => i.producto_id)));
    const stockQ = await supabase
      .from("inventario_stock_ubicacion")
      .select("producto_id, stock_actual")
      .eq("empresa_id", auth.empresa_id)
      .eq("ubicacion_id", origenId)
      .in("producto_id", productoIds);
    if (stockQ.error) throw new Error(stockQ.error.message);
    const stockMap = new Map<string, number>();
    for (const r of (stockQ.data ?? []) as Array<{ producto_id: string; stock_actual: number }>) {
      stockMap.set(r.producto_id, Number(r.stock_actual) || 0);
    }
    for (const it of items) {
      const disp = stockMap.get(it.producto_id) ?? 0;
      if (Number(it.cantidad) > disp) {
        return NextResponse.json(errorResponse(`Stock insuficiente del producto ${it.producto_id}: hay ${disp}, se piden ${it.cantidad}.`), { status: 400 });
      }
    }

    // Próximo número (NR-XXXXXX)
    const maxQ = await supabase
      .from("notas_remision")
      .select("numero")
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (maxQ.error) throw new Error(maxQ.error.message);
    let next = 1;
    const last = maxQ.data?.[0]?.numero as string | undefined;
    if (last) {
      const m = last.match(/(\d+)$/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const numero = `NR-${String(next).padStart(6, "0")}`;

    const insNr = await supabase
      .from("notas_remision")
      .insert({
        empresa_id: auth.empresa_id,
        numero,
        emisor,
        ubicacion_origen_id: origenId,
        ubicacion_destino_id: destinoId,
        motivo,
        estado: "pendiente",
        transportista: body.transportista?.trim() || null,
        ruc_transportista: body.ruc_transportista?.trim() || null,
        conductor: body.conductor?.trim() || null,
        ci_conductor: body.ci_conductor?.trim() || null,
        chapa: body.chapa?.trim() || null,
        fecha_inicio_traslado: body.fecha_inicio_traslado || null,
        fecha_fin_traslado: body.fecha_fin_traslado || null,
        observaciones: body.observaciones?.trim() || null,
      })
      .select(COLS)
      .single();
    if (insNr.error) return NextResponse.json(errorResponse(insNr.error.message), { status: 400 });
    const nr = insNr.data as { id: string };

    const insItems = await supabase.from("notas_remision_items").insert(
      items.map((i) => ({
        nota_remision_id: nr.id,
        producto_id: i.producto_id,
        cantidad: Number(i.cantidad),
      }))
    );
    if (insItems.error) {
      // Rollback best-effort
      await supabase.from("notas_remision").delete().eq("id", nr.id);
      return NextResponse.json(errorResponse(`Items: ${insItems.error.message}`), { status: 400 });
    }

    return NextResponse.json(successResponse({ nota_remision: { ...nr, items } }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
