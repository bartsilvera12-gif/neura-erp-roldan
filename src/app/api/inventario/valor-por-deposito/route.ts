import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";

/**
 * GET /api/inventario/valor-por-deposito — cuánta plata hay en mercadería, y dónde.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Que en mercaderías lo traiga ahí directamente, que diferencie entre el
 *   monto central y el monto sucursal, para saber qué valor tenemos en central
 *   y cuánto hay en sucursal, valorizado en dinero."
 *
 * ── CÓMO SE VALORIZA ───────────────────────────────────────────────────────
 *   unidades × costo_promedio. Es lo que COSTÓ la mercadería, no lo que se va
 *   a cobrar por ella: la posición de liquidez mide lo que la empresa tiene
 *   inmovilizado, y valuarla a precio de venta sería contar una ganancia que
 *   todavía no ocurrió.
 *
 * ── DE DÓNDE SALE EL "DÓNDE" ───────────────────────────────────────────────
 *   De `inventario_stock_ubicacion`, que dice cuántas unidades de cada
 *   artículo hay en cada depósito. Cada depósito pertenece a una sucursal, y
 *   de ahí sale el corte central / sucursal.
 *
 *   LO QUE NO TIENE FILA AHÍ se informa aparte, en `sin_ubicar`, con su valor.
 *   No se reparte ni se asigna al principal: sería inventar una ubicación. Hoy
 *   esto importa mucho — la migración cargó el stock en `productos` y nunca
 *   escribió el stock por depósito, así que hasta que corra el script 66 casi
 *   todo el inventario cae acá.
 */

type FilaProducto = {
  id: string;
  stock_actual: number | string | null;
  costo_promedio: number | string | null;
  sucursal_id: string | null;
  controla_stock: boolean | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export interface ValorDeposito {
  ubicacion_id: string;
  nombre: string;
  sucursal_id: string | null;
  sucursal_nombre: string;
  /** true si es la sucursal marcada como principal. */
  es_central: boolean;
  articulos: number;
  unidades: number;
  valor_gs: number;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    // ── Sucursales, para saber cuál es la central ─────────────────────────
    const sucQ = await ctx.supabase
      .from("sucursales")
      .select("id, nombre, es_principal")
      .eq("empresa_id", empresaId);
    if (sucQ.error) throw new Error(sucQ.error.message);
    const sucursales = new Map<string, { nombre: string; principal: boolean }>();
    for (const s of (sucQ.data ?? []) as Array<Record<string, unknown>>) {
      sucursales.set(String(s.id), {
        nombre: String(s.nombre ?? ""),
        principal: s.es_principal === true,
      });
    }

    // ── Depósitos ─────────────────────────────────────────────────────────
    const ubiQ = await ctx.supabase
      .from("inventario_ubicaciones")
      .select("id, nombre, sucursal_id, activo")
      .eq("empresa_id", empresaId);
    if (ubiQ.error) throw new Error(ubiQ.error.message);
    const ubicaciones = new Map<string, { nombre: string; sucursal_id: string | null }>();
    for (const u of (ubiQ.data ?? []) as Array<Record<string, unknown>>) {
      ubicaciones.set(String(u.id), {
        nombre: String(u.nombre ?? ""),
        sucursal_id: u.sucursal_id ? String(u.sucursal_id) : null,
      });
    }

    // ── Costo de cada artículo ────────────────────────────────────────────
    const productos = await traerTodas<FilaProducto>((d, h) =>
      ctx.supabase
        .from("productos")
        .select("id, stock_actual, costo_promedio, sucursal_id, controla_stock")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .order("id", { ascending: true })
        .range(d, h)
    );
    const costo = new Map<string, number>();
    const stockFicha = new Map<string, number>();
    for (const p of productos) {
      if (p.controla_stock === false) continue;
      costo.set(String(p.id), num(p.costo_promedio));
      stockFicha.set(String(p.id), num(p.stock_actual));
    }

    // ── Stock por depósito ────────────────────────────────────────────────
    const porUbicacion = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("inventario_stock_ubicacion")
        .select("producto_id, ubicacion_id, stock_actual")
        .eq("empresa_id", empresaId)
        .order("id", { ascending: true })
        .range(d, h)
    );

    const acum = new Map<string, ValorDeposito>();
    /** Unidades ya asignadas a algún depósito, por artículo. */
    const ubicadas = new Map<string, number>();

    for (const r of porUbicacion) {
      const prod = String(r.producto_id ?? "");
      const ubi = String(r.ubicacion_id ?? "");
      if (!prod || !ubi || !costo.has(prod)) continue;
      const unidades = num(r.stock_actual);
      if (unidades === 0) continue;

      ubicadas.set(prod, (ubicadas.get(prod) ?? 0) + unidades);

      const info = ubicaciones.get(ubi);
      const sucId = info?.sucursal_id ?? null;
      const suc = sucId ? sucursales.get(sucId) : undefined;
      let a = acum.get(ubi);
      if (!a) {
        a = {
          ubicacion_id: ubi,
          nombre: info?.nombre || "(depósito desconocido)",
          sucursal_id: sucId,
          sucursal_nombre: suc?.nombre ?? "—",
          es_central: suc?.principal === true,
          articulos: 0, unidades: 0, valor_gs: 0,
        };
        acum.set(ubi, a);
      }
      a.articulos += 1;
      a.unidades += unidades;
      a.valor_gs += unidades * (costo.get(prod) ?? 0);
    }

    // ── Lo que no está en ningún depósito ─────────────────────────────────
    // No se reparte ni se manda al principal: sería inventar una ubicación.
    let sinUbicarArticulos = 0, sinUbicarUnidades = 0, sinUbicarValor = 0;
    for (const [prod, stock] of stockFicha) {
      const resto = stock - (ubicadas.get(prod) ?? 0);
      if (resto <= 0) continue;
      sinUbicarArticulos += 1;
      sinUbicarUnidades += resto;
      sinUbicarValor += resto * (costo.get(prod) ?? 0);
    }

    const depositos = [...acum.values()].sort((a, b) => {
      // La central primero: es la que se mira antes.
      if (a.es_central !== b.es_central) return a.es_central ? -1 : 1;
      return b.valor_gs - a.valor_gs;
    });

    const valorUbicado = depositos.reduce((s, d) => s + d.valor_gs, 0);

    return NextResponse.json(successResponse({
      depositos,
      sin_ubicar: {
        articulos: sinUbicarArticulos,
        unidades: sinUbicarUnidades,
        valor_gs: sinUbicarValor,
      },
      /** Lo que está repartido en depósitos. */
      valor_ubicado_gs: valorUbicado,
      /** Todo el inventario, esté ubicado o no. Es el valor real de la mercadería. */
      valor_total_gs: valorUbicado + sinUbicarValor,
      /** Por si la pantalla quiere mostrar el corte central / resto agregado. */
      central_gs: depositos.filter((d) => d.es_central).reduce((s, d) => s + d.valor_gs, 0),
      sucursales_gs: depositos.filter((d) => !d.es_central).reduce((s, d) => s + d.valor_gs, 0),
    }));
  } catch (err) {
    console.error("[/api/inventario/valor-por-deposito]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo valorizar la mercadería."),
      { status: 500 }
    );
  }
}
