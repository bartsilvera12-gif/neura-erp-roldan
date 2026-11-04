import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";
import {
  armarFilas, resumirProveedores, veredicto,
  type ItemCotizado, type PrecioCotizado, type ProveedorCotiza,
} from "@/lib/compras/comparativo";

/**
 * Pedidos de cotización y su comparativo.
 *
 * GET              — lista de cotizaciones.
 * GET ?id=…        — una, con su grilla ya comparada.
 * POST             — crea una con sus artículos.
 * PUT  { id, precios[] } — carga o corrige precios.
 * PATCH{ id, estado }    — cierra o anula.
 *
 * ── EL COMPARATIVO SE CALCULA AL LEER ──────────────────────────────────────
 *   No se guarda quién ganó. Si mañana se corrige un precio mal tipeado, el
 *   ganador cambia solo; guardarlo obligaría a recalcular a mano y, el día que
 *   alguien se olvide, la pantalla mostraría un ganador que ya no lo es.
 */

const AVISO_72 = "Falta correr el script 72: la base todavía no guarda cotizaciones.";
const falta72 = (m: string) => /cotizacion(es|_items|_precios)/.test(m);

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const txt = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

type Ctx = NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();

    try {
      if (!id) {
        const q = await ctx.supabase
          .from("cotizaciones")
          .select("id, numero_control, fecha, estado, observaciones")
          .eq("empresa_id", ctx.auth.empresa_id)
          .order("numero_control", { ascending: false })
          .limit(200);
        if (q.error) throw new Error(q.error.message);
        return NextResponse.json(successResponse({ cotizaciones: q.data ?? [], disponible: true }));
      }
      return NextResponse.json(successResponse(await comparativo(ctx, id)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!falta72(msg)) throw e;
      return NextResponse.json(successResponse({
        cotizaciones: [], disponible: false, aviso: AVISO_72,
      }));
    }
  } catch (err) {
    console.error("[/api/compras/cotizaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las cotizaciones."), { status: 500 });
  }
}

/** La grilla completa: artículos, proveedores, precios y el veredicto. */
async function comparativo(ctx: Ctx, id: string) {
  const empresaId = ctx.auth.empresa_id;

  const cQ = await ctx.supabase
    .from("cotizaciones")
    .select("id, numero_control, fecha, estado, observaciones")
    .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (cQ.error) throw new Error(cQ.error.message);
  if (!cQ.data) throw new Error("Cotización no encontrada.");

  const itemsRaw = await traerTodas<Record<string, unknown>>((d, h) =>
    ctx.supabase
      .from("cotizacion_items")
      .select("id, producto_id, descripcion, cantidad, unidad, orden")
      .eq("empresa_id", empresaId).eq("cotizacion_id", id)
      .order("orden", { ascending: true })
      .range(d, h)
  );
  const items: ItemCotizado[] = itemsRaw.map((r) => ({
    id: String(r.id),
    descripcion: String(r.descripcion ?? ""),
    cantidad: num(r.cantidad),
    unidad: String(r.unidad ?? "UNIDAD"),
  }));

  const preciosRaw = await traerTodas<Record<string, unknown>>((d, h) =>
    ctx.supabase
      .from("cotizacion_precios")
      .select("item_id, proveedor_id, precio_unitario, plazo_dias, observacion")
      .eq("empresa_id", empresaId).eq("cotizacion_id", id)
      .order("id", { ascending: true })
      .range(d, h)
  );
  const precios: PrecioCotizado[] = preciosRaw.map((r) => ({
    item_id: String(r.item_id),
    proveedor_id: String(r.proveedor_id),
    precio_unitario: num(r.precio_unitario),
    plazo_dias: r.plazo_dias == null ? null : Number(r.plazo_dias),
  }));

  // Los proveedores que participan: los que tienen al menos un precio.
  const ids = [...new Set(precios.map((p) => p.proveedor_id))];
  let proveedores: ProveedorCotiza[] = [];
  if (ids.length > 0) {
    const q = await ctx.supabase
      .from("proveedores")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .in("id", ids.slice(0, 200))
      .order("nombre");
    if (q.error) throw new Error(q.error.message);
    proveedores = ((q.data ?? []) as Array<Record<string, unknown>>)
      .map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? "") }));
  }

  const filas = armarFilas(items, proveedores, precios);
  const resumen = resumirProveedores(items, proveedores, filas);

  return {
    cotizacion: cQ.data,
    items, proveedores, filas, resumen,
    veredicto: veredicto(items, proveedores, filas, resumen),
    disponible: true,
  };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const itemsIn = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const items = itemsIn
      .map((i) => ({
        producto_id: i.producto_id ? String(i.producto_id) : null,
        descripcion: txt(i.descripcion),
        cantidad: num(i.cantidad) || 1,
        unidad: txt(i.unidad, 20) || "UNIDAD",
      }))
      .filter((i) => i.descripcion !== "");
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Agregá al menos un artículo a cotizar."), { status: 400 });
    }

    try {
      // Correlativo COT-XXXXXX.
      const maxQ = await ctx.supabase
        .from("cotizaciones").select("numero_control")
        .eq("empresa_id", empresaId).like("numero_control", "COT-%")
        .order("numero_control", { ascending: false }).limit(1);
      if (maxQ.error) throw new Error(maxQ.error.message);
      const last = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
      const m = last?.match(/^COT-(\d+)$/);
      const numeroControl = `COT-${String(m ? parseInt(m[1], 10) + 1 : 1).padStart(6, "0")}`;

      const ins = await ctx.supabase
        .from("cotizaciones")
        .insert({
          empresa_id: empresaId,
          numero_control: numeroControl,
          fecha: typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)
            ? body.fecha
            : new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10),
          observaciones: txt(body.observaciones, 1000) || null,
          created_by: ctx.auth.user?.id ?? null,
        })
        .select("id, numero_control").single();
      if (ins.error) throw new Error(ins.error.message);
      const cotizacionId = String((ins.data as { id: string }).id);

      const insItems = await ctx.supabase.from("cotizacion_items").insert(
        items.map((i, k) => ({ empresa_id: empresaId, cotizacion_id: cotizacionId, ...i, orden: k }))
      );
      if (insItems.error) {
        // Sin artículos la cotización no sirve: se deshace para no dejarla colgada.
        await ctx.supabase.from("cotizaciones").delete().eq("id", cotizacionId).eq("empresa_id", empresaId);
        throw new Error(insItems.error.message);
      }

      return NextResponse.json(successResponse({
        id: cotizacionId, numero_control: numeroControl, items: items.length,
      }), { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (falta72(msg)) return NextResponse.json(errorResponse(AVISO_72), { status: 503 });
      throw e;
    }
  } catch (err) {
    console.error("[/api/compras/cotizaciones POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la cotización."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = txt(body.id, 64);
    const proveedorId = txt(body.proveedor_id, 64);
    if (!id || !proveedorId) {
      return NextResponse.json(errorResponse("Falta la cotización o el proveedor."), { status: 400 });
    }

    const entradas = Array.isArray(body.precios) ? (body.precios as Record<string, unknown>[]) : [];

    try {
      // Se reemplazan los precios DE ESE PROVEEDOR, no los de todos: cada uno
      // se carga cuando contesta, y guardar al segundo no puede borrar al
      // primero.
      const del = await ctx.supabase
        .from("cotizacion_precios").delete()
        .eq("empresa_id", empresaId).eq("cotizacion_id", id).eq("proveedor_id", proveedorId);
      if (del.error) throw new Error(del.error.message);

      // Un precio en cero NO se guarda: la ausencia de fila es lo que
      // significa "no lo cotizó", y un cero diría que lo regala.
      const filas = entradas
        .map((e) => ({
          empresa_id: empresaId,
          cotizacion_id: id,
          item_id: txt(e.item_id, 64),
          proveedor_id: proveedorId,
          precio_unitario: num(e.precio_unitario),
          plazo_dias: e.plazo_dias == null || e.plazo_dias === "" ? null : Number(e.plazo_dias) || null,
          observacion: txt(e.observacion, 200) || null,
        }))
        .filter((f) => f.item_id && f.precio_unitario > 0);

      if (filas.length > 0) {
        const ins = await ctx.supabase.from("cotizacion_precios").insert(filas);
        if (ins.error) throw new Error(ins.error.message);
      }

      return NextResponse.json(successResponse({ ok: true, cargados: filas.length }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (falta72(msg)) return NextResponse.json(errorResponse(AVISO_72), { status: 503 });
      throw e;
    }
  } catch (err) {
    console.error("[/api/compras/cotizaciones PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron guardar los precios."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = txt(body.id, 64);
    const estado = txt(body.estado, 20);
    if (!id) return NextResponse.json(errorResponse("Falta la cotización."), { status: 400 });
    if (!["abierta", "cerrada", "anulada"].includes(estado)) {
      return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
    }
    const upd = await ctx.supabase
      .from("cotizaciones")
      .update({ estado, updated_at: new Date().toISOString() })
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (upd.error) throw new Error(upd.error.message);
    return NextResponse.json(successResponse({ ok: true, estado }));
  } catch (err) {
    console.error("[/api/compras/cotizaciones PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cambiar el estado."), { status: 500 });
  }
}
