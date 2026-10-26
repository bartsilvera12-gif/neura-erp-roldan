import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/clientes/[id]/historial — compras históricas del cliente (punto 3.3).
 *
 * Para qué sirve en el mostrador: el cliente pregunta "¿cuánto me saliste la
 * última vez?" o "¿de qué medida te llevé?". Hoy eso se contesta buscando la
 * venta a mano, y solo si uno se acuerda de la fecha.
 *
 * Devuelve las ventas con su detalle y un resumen: cuánto compró en total,
 * cuántas veces, el promedio y qué productos lleva más seguido.
 *
 * Parámetros opcionales:
 *   desde, hasta — YYYY-MM-DD en hora de Paraguay, ambas inclusive.
 *   limite       — máx. 500. Por defecto 100.
 */

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id: clienteId } = await context.params;
    const sp = new URL(request.url).searchParams;

    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
    const limite = Math.min(500, Math.max(1, parseInt(sp.get("limite") ?? "100", 10) || 100));

    let q = aplicarFiltroSucursal(
      ctx.supabase
        .from("ventas")
        .select("id, numero_control, fecha, total, estado, tipo_venta, metodo_pago, factura_id")
        .eq("empresa_id", empresaId)
        .eq("cliente_id", clienteId),
      sucursalId
    );
    // El día "hasta" entra entero.
    if (desde) q = q.gte("fecha", `${desde}T00:00:00${OFFSET_PY}`);
    if (hasta) q = q.lte("fecha", `${hasta}T23:59:59.999${OFFSET_PY}`);

    const vQ = await q.order("fecha", { ascending: false }).limit(limite);
    if (vQ.error) throw new Error(vQ.error.message);
    const ventas = (vQ.data ?? []) as Array<Record<string, unknown>>;

    // Ítems de esas ventas, para el detalle y para saber qué lleva seguido.
    const ids = ventas.map((v) => String(v.id));
    const itemsPorVenta = new Map<string, Array<Record<string, unknown>>>();
    const vecesPorProducto = new Map<string, { nombre: string; veces: number; unidades: number }>();

    if (ids.length > 0) {
      // PostgREST corta en 1000 filas: se pagina para no perder ítems de las
      // ventas más viejas del período.
      const CHUNK = 1000;
      for (let desdeFila = 0; desdeFila < 50_000; desdeFila += CHUNK) {
        const iQ = await ctx.supabase
          .from("ventas_items")
          .select("venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta, total_linea")
          .eq("empresa_id", empresaId)
          .in("venta_id", ids)
          .range(desdeFila, desdeFila + CHUNK - 1);
        if (iQ.error) throw new Error(iQ.error.message);
        const lote = (iQ.data ?? []) as Array<Record<string, unknown>>;
        if (lote.length === 0) break;

        for (const it of lote) {
          const vid = String(it.venta_id);
          const lista = itemsPorVenta.get(vid);
          if (lista) lista.push(it);
          else itemsPorVenta.set(vid, [it]);

          const pid = String(it.producto_id ?? "");
          if (pid) {
            const act = vecesPorProducto.get(pid) ?? {
              nombre: String(it.producto_nombre ?? ""), veces: 0, unidades: 0,
            };
            act.veces += 1;
            act.unidades += Number(it.cantidad) || 0;
            vecesPorProducto.set(pid, act);
          }
        }
        if (lote.length < CHUNK) break;
      }
    }

    // Las anuladas se listan para que no parezca que falta una venta, pero no
    // cuentan en los totales: no son plata que entró.
    const activas = ventas.filter((v) => String(v.estado ?? "") !== "anulada");
    const totalComprado = activas.reduce((s, v) => s + (Number(v.total) || 0), 0);

    const filas = ventas.map((v) => ({
      id: String(v.id),
      numero_control: String(v.numero_control ?? ""),
      fecha: String(v.fecha ?? ""),
      total: Number(v.total) || 0,
      estado: v.estado == null ? null : String(v.estado),
      tipo_venta: v.tipo_venta == null ? null : String(v.tipo_venta),
      metodo_pago: v.metodo_pago == null ? null : String(v.metodo_pago),
      tiene_factura: Boolean(v.factura_id),
      items: (itemsPorVenta.get(String(v.id)) ?? []).map((i) => ({
        producto_nombre: String(i.producto_nombre ?? ""),
        sku: i.sku == null ? null : String(i.sku),
        cantidad: Number(i.cantidad) || 0,
        precio_venta: Number(i.precio_venta) || 0,
        total_linea: Number(i.total_linea) || 0,
      })),
    }));

    const masLlevados = [...vecesPorProducto.values()]
      .sort((a, b) => b.veces - a.veces || b.unidades - a.unidades)
      .slice(0, 5);

    return NextResponse.json(successResponse({
      ventas: filas,
      resumen: {
        operaciones: activas.length,
        anuladas: ventas.length - activas.length,
        total_comprado: totalComprado,
        promedio: activas.length > 0 ? totalComprado / activas.length : 0,
        ultima_compra: activas[0]?.fecha ?? null,
        mas_llevados: masLlevados,
      },
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/clientes/[id]/historial]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el historial del cliente."),
      { status: 500 }
    );
  }
}
