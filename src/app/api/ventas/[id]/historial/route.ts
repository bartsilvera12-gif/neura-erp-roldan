import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/ventas/[id]/historial — todo lo que le pasó a una venta después de
 * emitida: las ediciones (quién, cuándo, por qué y qué cambió) y las
 * devoluciones.
 *
 * ── POR QUÉ APARTE DE `/api/ventas` ───────────────────────────────────────
 *   El listado trae cientos de ventas y casi ninguna tiene ediciones ni
 *   devoluciones. Cargar las dos tablas para todas sería pagar dos consultas
 *   grandes en cada apertura de pantalla para mostrar, casi siempre, nada.
 *   Acá se piden solo cuando alguien abre esa venta en particular.
 *
 *   El listado sí trae las BANDERAS (`editada`, `tiene_devolucion`), que salen
 *   de dos consultas de ids y alcanzan para pintar el aviso en la fila.
 */
export const dynamic = "force-dynamic";

interface EdicionRow {
  fecha: string;
  usuario_nombre: string | null;
  motivo: string | null;
  total_antes: number | string | null;
  total_despues: number | string | null;
  cambios: unknown;
}

interface DevolucionRow {
  id: string;
  numero_devolucion: string | null;
  created_at: string;
  tipo: string | null;
  resolucion: string | null;
  estado: string | null;
  motivo: string | null;
  total_devuelto: number | string | null;
  usuario_nombre: string | null;
  anulada_at: string | null;
}

interface DevolucionItemRow {
  devolucion_id: string;
  producto_nombre: string | null;
  sku: string | null;
  cantidad_devuelta: number | string | null;
  total_devuelto: number | string | null;
  condicion: string | null;
}

const num = (v: unknown): number => Number(v) || 0;

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const [edQ, devQ] = await Promise.all([
      ctx.supabase
        .from("ventas_ediciones")
        .select("fecha, usuario_nombre, motivo, total_antes, total_despues, cambios")
        .eq("empresa_id", empresaId)
        .eq("venta_id", id)
        .order("fecha", { ascending: false }),
      ctx.supabase
        .from("devoluciones_venta")
        .select(
          "id, numero_devolucion, created_at, tipo, resolucion, estado, motivo, total_devuelto, usuario_nombre, anulada_at"
        )
        .eq("empresa_id", empresaId)
        .eq("venta_id", id)
        .order("created_at", { ascending: false }),
    ]);
    if (edQ.error) throw new Error(edQ.error.message);
    if (devQ.error) throw new Error(devQ.error.message);

    const devRows = (devQ.data ?? []) as unknown as DevolucionRow[];

    // Los ítems de las devoluciones, en una sola consulta para todas.
    let itemsPorDev = new Map<string, DevolucionItemRow[]>();
    if (devRows.length) {
      const itQ = await ctx.supabase
        .from("devoluciones_venta_items")
        .select("devolucion_id, producto_nombre, sku, cantidad_devuelta, total_devuelto, condicion")
        .eq("empresa_id", empresaId)
        .in("devolucion_id", devRows.map((d) => d.id));
      if (itQ.error) throw new Error(itQ.error.message);
      itemsPorDev = ((itQ.data ?? []) as unknown as DevolucionItemRow[]).reduce((m, r) => {
        const l = m.get(r.devolucion_id) ?? [];
        l.push(r);
        m.set(r.devolucion_id, l);
        return m;
      }, new Map<string, DevolucionItemRow[]>());
    }

    const ediciones = ((edQ.data ?? []) as unknown as EdicionRow[]).map((e) => ({
      fecha: e.fecha,
      usuario_nombre: e.usuario_nombre ?? null,
      motivo: e.motivo ?? null,
      total_antes: num(e.total_antes),
      total_despues: num(e.total_despues),
      // `cambios` es jsonb con [{campo, antes, despues}]. Se devuelve tal cual
      // y se normaliza a texto en la pantalla: una edición vieja puede tener
      // otra forma y no vale la pena romperse por eso.
      cambios: Array.isArray(e.cambios) ? e.cambios : [],
    }));

    const devoluciones = devRows.map((d) => ({
      id: d.id,
      numero: d.numero_devolucion ?? null,
      fecha: d.created_at,
      tipo: d.tipo ?? null,
      resolucion: d.resolucion ?? null,
      estado: d.estado ?? null,
      motivo: d.motivo ?? null,
      total_devuelto: num(d.total_devuelto),
      usuario_nombre: d.usuario_nombre ?? null,
      anulada_at: d.anulada_at ?? null,
      items: (itemsPorDev.get(d.id) ?? []).map((i) => ({
        producto_nombre: i.producto_nombre ?? "",
        sku: i.sku ?? null,
        cantidad: num(i.cantidad_devuelta),
        total: num(i.total_devuelto),
        condicion: i.condicion ?? null,
      })),
    }));

    return NextResponse.json(successResponse({ ediciones, devoluciones }));
  } catch (err) {
    console.error("[/api/ventas/[id]/historial GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de la venta."), { status: 500 });
  }
}
