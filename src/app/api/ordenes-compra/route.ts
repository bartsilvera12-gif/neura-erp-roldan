import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { SIN_PROVEEDOR } from "@/lib/compras/orden-estado";
import {
  accionesRecepcion,
  confirmarRecepcion,
  deshacerRecepcion,
  type ActorRecepcion,
  type OrdenRecepcion,
} from "@/lib/compras/recepcion";

export const dynamic = "force-dynamic";

/**
 * Órdenes de compra (PEDIDO al proveedor). Documento que se le envía al proveedor
 * para que despache el pedido y emita la factura. NO es una compra registrada ni
 * toca inventario/costos; es previo a la compra.
 *
 * GET  /api/ordenes-compra            → lista
 * GET  /api/ordenes-compra?id=...     → una
 * POST /api/ordenes-compra            → crear
 * PATCH  { id, estado }               → cambiar estado (pendiente|anulada)
 * PATCH  { id, confirmar_recepcion }  → «Recibido» / «Aceptar» (doble confirmación)
 * PATCH  { id, deshacer_recepcion }   → volver a «En tránsito»
 * DELETE ?id=...                      → eliminar
 */

type Item = {
  descripcion: string; cantidad: number; unidad: string; precio_unitario: number;
  /** Del inventario: con esto «Cargar factura» arma la compra con el producto. */
  producto_id?: string | null; sku?: string | null;
  /** Descuento de la línea, en % (pedido del cliente). 0 si no tiene. */
  descuento_pct?: number;
};

/** Columnas del script 97: si faltan, se guarda sin ellas. */
const RE_FALTA_97 = /fecha_entrega|condicion|compra_numero|recibida_at/;
function sin97(o: Record<string, unknown>): Record<string, unknown> {
  const c = { ...o };
  delete c.fecha_entrega; delete c.condicion; delete c.compra_numero; delete c.recibida_at;
  return c;
}

/**
 * Columnas del script 100 (quién confirmó la recepción). Si todavía no se
 * corrió el script no hay dónde anotar las dos confirmaciones: «Recibido»
 * vuelve a ser un solo click, como antes, y la respuesta lo avisa en
 * `recepcion_doble: false` para que la pantalla lo diga.
 */
const RE_FALTA_100 = /recibida_por_1|recibida_por_2/;
const COLUMNAS_100 = [
  "recibida_por_1", "recibida_por_1_nombre", "recibida_por_1_at",
  "recibida_por_2", "recibida_por_2_nombre", "recibida_por_2_at",
] as const;
function sin100(o: Record<string, unknown>): Record<string, unknown> {
  const c = { ...o };
  for (const k of COLUMNAS_100) delete c[k];
  return c;
}
const fechaValida = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

function normItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      descripcion: String(o.descripcion ?? "").trim(),
      cantidad: Number(o.cantidad) || 0,
      unidad: String(o.unidad ?? "").trim() || "UNIDAD",
      precio_unitario: Number(o.precio_unitario) || 0,
      producto_id: o.producto_id != null && String(o.producto_id).trim() !== "" ? String(o.producto_id) : null,
      sku: o.sku != null && String(o.sku).trim() !== "" ? String(o.sku) : null,
      // Entre 0 y 100: un descuento negativo o de 300% no es un descuento.
      descuento_pct: Math.min(100, Math.max(0, Number(o.descuento_pct) || 0)),
    };
  }).filter((i) => i.descripcion !== "");
}

export async function GET(req: NextRequest) {
  try {
    // Con rol: hace falta saber si es administrador para decir qué botón de
    // recepción le toca a cada orden.
    const ctx = await getTenantSupabaseFromAuthWithRol(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (id) {
      const { data, error } = await ctx.supabase
        .from("ordenes_compra").select("*")
        .eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle();
      if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
      if (!data) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });
      return NextResponse.json(successResponse({ orden: data }));
    }
    const { data, error } = await ctx.supabase
      .from("ordenes_compra").select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("fecha", { ascending: false })
      .order("numero_control", { ascending: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });

    // Qué botón de recepción le toca a quien pregunta. Se calcula en el
    // servidor para no mandarle al navegador los ids de los usuarios ni
    // dejarle decidir quién puede aceptar.
    const actor = actorDe(ctx);
    const filas = (data ?? []) as Record<string, unknown>[];
    const ordenes = filas.map((o) => ({
      ...o,
      _recepcion: accionesRecepcion(o as OrdenRecepcion, actor),
    }));
    return NextResponse.json(successResponse({
      ordenes,
      recepcion_doble: filas.length === 0
        ? true
        : Object.prototype.hasOwnProperty.call(filas[0]!, "recibida_por_1_at"),
    }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // El proveedor es opcional (pedido del cliente): se puede pedir sin
    // saber todavía a quién; se elige al cargar la factura.
    const proveedorNombre = String(body.proveedor_nombre ?? "").trim() || SIN_PROVEEDOR;
    const items = normItems(body.items);
    if (items.length === 0) return NextResponse.json(errorResponse("Agregá al menos un ítem."), { status: 400 });

    // Correlativo OC-XXXXXX.
    const maxQ = await ctx.supabase
      .from("ordenes_compra").select("numero_control")
      .eq("empresa_id", empresaId).like("numero_control", "OC-%")
      .order("numero_control", { ascending: false }).limit(1);
    let next = 1;
    const last = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
    const m = last?.match(/^OC-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
    const numeroControl = `OC-${String(next).padStart(6, "0")}`;

    const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : new Date().toISOString().slice(0, 10);
    const insert = {
      empresa_id: empresaId,
      numero_control: numeroControl,
      proveedor_id: body.proveedor_id != null && String(body.proveedor_id).trim() !== "" ? String(body.proveedor_id) : null,
      proveedor_nombre: proveedorNombre,
      fecha,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      estado: "pendiente",
      observaciones: body.observaciones != null && String(body.observaciones).trim() !== "" ? String(body.observaciones).trim() : null,
      items,
      created_by: ctx.auth.user?.id ?? null,
      fecha_entrega: fechaValida(body.fecha_entrega),
      condicion: body.condicion === "credito" ? "credito" : "contado",
    };
    let { data, error } = await ctx.supabase.from("ordenes_compra").insert(insert).select().single();
    if (error && RE_FALTA_97.test(error.message)) {
      ({ data, error } = await ctx.supabase.from("ordenes_compra").insert(sin97(insert)).select().single());
    }
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ orden: data }), { status: 201 });
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

type CtxConRol = NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuthWithRol>>>;

function actorDe(ctx: CtxConRol): ActorRecepcion {
  return {
    usuarioId: ctx.auth.user?.id ?? ctx.auth.usuarioCatalogId ?? null,
    nombre: ctx.auth.nombre ?? null,
    esAdmin: isAdmin(ctx.auth),
  };
}

/**
 * «Recibido» (1ª confirmación), «Aceptar» (2ª, administrador) y volver a
 * tránsito. Lee la orden, aplica la regla de `lib/compras/recepcion.ts` y
 * guarda. Si faltan las columnas del script 100, cae al comportamiento de
 * antes (un solo click) y lo avisa.
 */
async function recepcion(ctx: CtxConRol, id: string, confirmar: boolean) {
  const empresaId = ctx.auth.empresa_id;
  const actor = actorDe(ctx);

  const sel = await ctx.supabase
    .from("ordenes_compra").select("*")
    .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (sel.error) return NextResponse.json(errorResponse(sel.error.message), { status: 500 });
  if (!sel.data) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });

  const fila = sel.data as Record<string, unknown>;
  // Sin script 100 la tabla no tiene las columnas: no hay doble confirmación.
  const hayColumnas = Object.prototype.hasOwnProperty.call(fila, "recibida_por_1_at");
  if (!hayColumnas) {
    const patch = confirmar
      ? { estado: "recibida", recibida_at: new Date().toISOString() }
      : { estado: "pendiente", recibida_at: null };
    const { error } = await ctx.supabase
      .from("ordenes_compra").update(patch)
      .eq("empresa_id", empresaId).eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({
      ok: true,
      recepcion_doble: false,
      aviso: "Falta correr el script 100: por ahora «Recibido» lo marca una sola persona.",
    }));
  }

  const orden = fila as OrdenRecepcion;
  const r = confirmar ? confirmarRecepcion(orden, actor) : deshacerRecepcion(orden, actor);
  if (!r.ok) return NextResponse.json(errorResponse(r.error), { status: r.status });

  let { error } = await ctx.supabase
    .from("ordenes_compra").update(r.patch)
    .eq("empresa_id", empresaId).eq("id", id);
  if (error && RE_FALTA_100.test(error.message)) {
    const resto = sin100(r.patch);
    if (Object.keys(resto).length > 0) {
      ({ error } = await ctx.supabase.from("ordenes_compra").update(resto)
        .eq("empresa_id", empresaId).eq("id", id));
    } else error = null;
  }
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });

  return NextResponse.json(successResponse({
    ok: true,
    recepcion_doble: true,
    paso: r.paso,
    // Lo que la pantalla le dice a la persona.
    mensaje: confirmar
      ? r.paso === 1
        ? "Marcada como recibida. Falta que un administrador la acepte."
        : "Recepción confirmada por dos personas."
      : "La orden volvió a «En tránsito».",
  }));
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta id."), { status: 400 });

    // ── «Recibido» / «Aceptar» / volver a tránsito ────────────────────────
    // Van por su propio camino porque la regla es de dos personas y hay que
    // leer la orden antes de decidir. `estado: "recibida"` entra acá también:
    // así un cliente viejo no se saltea el control marcándola de una.
    const quiereConfirmar = body.confirmar_recepcion === true || body.estado === "recibida";
    const quiereDeshacer = body.deshacer_recepcion === true;
    if (quiereConfirmar || quiereDeshacer) {
      return await recepcion(ctx, id, quiereConfirmar);
    }

    // PATCH acepta ahora dos modos:
    //  - Solo cambio de estado (compatibilidad con "marcarRecibida").
    //  - Edición completa de la orden (proveedor / fecha / moneda / observaciones / items).
    // Se detecta por presencia de campos editables.
    const patch: Record<string, unknown> = {};
    if (body.estado !== undefined) {
      // «recibida» ya se manejó arriba (doble confirmación).
      patch.estado = String(body.estado) === "anulada" ? "anulada" : "pendiente";
    }
    if (body.fecha_entrega !== undefined) patch.fecha_entrega = fechaValida(body.fecha_entrega);
    if (body.condicion !== undefined) patch.condicion = body.condicion === "credito" ? "credito" : "contado";
    // «Cargar factura»: la compra que la facturó. Ya NO la da por recibida
    // (pedido del cliente): la recepción se confirma aparte, entre dos
    // personas, y cargar la factura salteaba ese control.
    if (typeof body.compra_numero === "string" && body.compra_numero.trim()) {
      patch.compra_numero = body.compra_numero.trim();
    }
    if (typeof body.proveedor_nombre === "string" && body.proveedor_nombre.trim() !== "") {
      patch.proveedor_nombre = body.proveedor_nombre.trim();
    }
    if (body.proveedor_id !== undefined) {
      patch.proveedor_id = body.proveedor_id != null && String(body.proveedor_id).trim() !== "" ? String(body.proveedor_id) : null;
    }
    if (typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
      patch.fecha = body.fecha;
    }
    if (body.moneda !== undefined) {
      patch.moneda = body.moneda === "USD" ? "USD" : "PYG";
    }
    if (body.observaciones !== undefined) {
      patch.observaciones = typeof body.observaciones === "string" && body.observaciones.trim() !== "" ? body.observaciones.trim() : null;
    }
    if (body.items !== undefined) {
      const items = normItems(body.items);
      if (items.length === 0) return NextResponse.json(errorResponse("Agregá al menos un ítem."), { status: 400 });
      patch.items = items;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }
    let { error } = await ctx.supabase
      .from("ordenes_compra").update(patch)
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error && RE_FALTA_97.test(error.message)) {
      const resto = sin97(patch);
      if (Object.keys(resto).length > 0) {
        ({ error } = await ctx.supabase.from("ordenes_compra").update(resto)
          .eq("empresa_id", ctx.auth.empresa_id).eq("id", id));
      } else error = null;
    }
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json(errorResponse("Falta id."), { status: 400 });
    const { error } = await ctx.supabase
      .from("ordenes_compra").delete()
      .eq("empresa_id", ctx.auth.empresa_id).eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
