import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { requireAdminProductos } from "@/lib/productos/require-admin-productos";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { preciosDeDeposito, stockDeDeposito } from "@/lib/precios/server/precio-deposito";
import { applyTokenSearch } from "@/lib/productos/token-search";

/**
 * Precios propios de un depósito.
 *
 * GET  ?deposito=<id>&q=  → cada producto con su precio de lista (el del
 *                           producto), el precio propio del depósito si tiene
 *                           uno, y cuánto hay en ese depósito.
 * PUT                     → guarda o borra el precio propio de un producto en
 *                           un depósito. Mandar los dos valores en null borra
 *                           la excepción y el depósito vuelve a cobrar la
 *                           lista. Solo administradores.
 *
 * POR QUÉ EL GET ES ABIERTO Y EL PUT NO: el personal de mostrador necesita ver
 * a qué precio vende; cambiar un precio es otra cosa. Mismo criterio que el
 * resto del catálogo (ver `requireAdminProductos`).
 */
export const dynamic = "force-dynamic";

const FALTA_TABLA =
  "Falta correr 51_precios_por_deposito.sql en la base: todavía no se pueden cargar precios por depósito.";

function esTablaFaltante(msg: string | null | undefined): boolean {
  const m = msg ?? "";
  return /producto_precios_deposito/.test(m) && /does not exist|schema cache|PGRST205|42P01/i.test(m);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;
    const depositoId = (sp.get("deposito") ?? "").trim();
    const q = (sp.get("q") ?? "").trim();

    if (!depositoId) {
      return NextResponse.json(errorResponse("Elegí un depósito."), { status: 400 });
    }

    // El depósito tiene que ser de esta empresa: sin esta validación se podrían
    // leer los precios de otro tenant pasando un uuid a mano.
    const dQ = await ctx.supabase
      .from("inventario_ubicaciones")
      .select("id, nombre, sucursal_id")
      .eq("empresa_id", empresaId)
      .eq("id", depositoId)
      .maybeSingle();
    if (dQ.error) throw new Error(dQ.error.message);
    if (!dQ.data) return NextResponse.json(errorResponse("Depósito no encontrado."), { status: 404 });
    const deposito = dQ.data as { id: string; nombre: string };

    let base = aplicarFiltroSucursal(
      ctx.supabase
        .from("productos")
        .select("id, nombre, sku, precio_venta, costo_promedio, stock_actual")
        .eq("empresa_id", empresaId)
        .eq("activo", true),
      sucursalId
    );
    if (q) base = applyTokenSearch(base, q, ["nombre", "sku"]);
    const pQ = await base.order("nombre").limit(500);
    if (pQ.error) throw new Error(pQ.error.message);

    const [precios, stock] = await Promise.all([
      preciosDeDeposito(ctx.supabase, empresaId, depositoId),
      stockDeDeposito(ctx.supabase, empresaId, depositoId),
    ]);

    const filas = ((pQ.data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => {
      const id = String(p.id);
      const propio = precios.mapa.get(id);
      const lista = Number(p.precio_venta) || 0;
      const precioDeposito = propio?.precio_venta ?? null;
      return {
        producto_id: id,
        nombre: String(p.nombre ?? ""),
        sku: p.sku == null ? "" : String(p.sku),
        costo: Number(p.costo_promedio) || 0,
        /** El de la sucursal: lo que se cobra si el depósito no define nada. */
        precio_lista: lista,
        /** El propio del depósito. null = cobra la lista. */
        precio_deposito: precioDeposito,
        markup_deposito: propio?.markup_pct ?? null,
        /** Cuánto se aparta del precio de lista, para verlo de un vistazo. */
        diferencia_pct:
          precioDeposito != null && lista > 0
            ? ((precioDeposito - lista) / lista) * 100
            : null,
        stock_deposito: stock.mapa.get(id) ?? null,
        stock_global: Number(p.stock_actual) || 0,
      };
    });

    return NextResponse.json(successResponse({
      deposito: { id: deposito.id, nombre: deposito.nombre },
      productos: filas,
      con_precio_propio: filas.filter((f) => f.precio_deposito != null).length,
      // Sin el script 51 no hay excepciones posibles: la pantalla lo dice en
      // vez de dejar guardar algo que va a fallar.
      aviso: precios.disponible ? null : FALTA_TABLA,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    if (esTablaFaltante(msg)) {
      return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
    }
    console.error("[/api/precios-deposito GET]", msg || err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar los precios del depósito."),
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const guard = await requireAdminProductos(request);
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  try {
    const empresaId = ctx.auth.empresa_id;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const depositoId = typeof b.deposito === "string" ? b.deposito.trim() : "";
    const productoId = typeof b.producto_id === "string" ? b.producto_id.trim() : "";
    if (!depositoId || !productoId) {
      return NextResponse.json(errorResponse("Faltan el depósito y el producto."), { status: 400 });
    }

    const precio = numOrNull(b.precio_venta);
    const markup = numOrNull(b.markup_pct);
    if (precio != null && precio < 0) {
      return NextResponse.json(errorResponse("El precio no puede ser negativo."), { status: 400 });
    }

    // Los dos en null significan "este depósito vuelve a cobrar la lista": se
    // borra la fila en vez de guardar una excepción vacía, que después se lee
    // como "acá hay algo definido" cuando no hay nada.
    if (precio == null && markup == null) {
      const del = await ctx.supabase
        .from("producto_precios_deposito")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("ubicacion_id", depositoId)
        .eq("producto_id", productoId);
      if (del.error) {
        if (esTablaFaltante(del.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
        }
        throw new Error(del.error.message);
      }
      return NextResponse.json(successResponse({ ok: true, borrado: true }));
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const up = await ctx.supabase
      .from("producto_precios_deposito")
      .upsert(
        {
          empresa_id: empresaId,
          ubicacion_id: depositoId,
          producto_id: productoId,
          precio_venta: precio,
          markup_pct: markup,
          actualizado_por: firma.nombre,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,producto_id,ubicacion_id" }
      )
      .select("producto_id, precio_venta, markup_pct")
      .single();
    if (up.error) {
      if (esTablaFaltante(up.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
      }
      throw new Error(up.error.message);
    }

    return NextResponse.json(successResponse({ ok: true, precio: up.data }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/precios-deposito PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar el precio del depósito."),
      { status: 500 }
    );
  }
}
