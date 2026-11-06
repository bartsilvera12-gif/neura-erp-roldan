import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { divisorIva } from "@/lib/precios/iva";
import {
  avanceDelMes, calcularPuntoEquilibrio, diasDelMes, margenDeVenta, mesAnterior,
} from "@/lib/contabilidad/punto-equilibrio";

/**
 * GET /api/contabilidad/punto-equilibrio?anio=2026&mes=11
 *
 * Cuánto hay que vender en el mes para cubrir los gastos, con el margen y los
 * gastos del mes ANTERIOR como referencia, y cómo viene el mes en curso.
 *
 * PARÁMETROS QUE PISAN EL SUPUESTO
 *   `margen`  — porcentaje a usar en vez del calculado.
 *   `gastos`  — gastos a cubrir en vez de los del mes anterior.
 *   Existen porque quien conoce el negocio puede saber mejor que el sistema:
 *   si en el mes anterior hubo un gasto extraordinario, repetirlo da una meta
 *   que no corresponde.
 *
 * ── DE DÓNDE SALE EL COSTO, Y POR QUÉ ES UNA ESTIMACIÓN ────────────────────
 *   El CMV debería salir de los movimientos de inventario de cada venta, pero
 *   la migración no los trajo: hay 48 movimientos de salida para 85.711
 *   ventas. `ventas_items` tampoco guarda el costo de la línea.
 *
 *   Así que se estima con el `costo_promedio` de HOY de cada artículo vendido.
 *   Para el mes pasado es una aproximación razonable; para meses viejos se
 *   degrada, porque los costos de hoy no son los de entonces. La respuesta lo
 *   dice (`costo_estimado: true`) para que la pantalla no presente un número
 *   estimado como si fuera medido.
 */

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Hoy en Paraguay (UTC−3). Con la fecha UTC, a las 21:00 ya sería mañana. */
function hoyPy(): { anio: number; mes: number; dia: number } {
  const d = new Date(Date.now() - 3 * 3_600_000);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

const primerDia = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;
const primerDiaSiguiente = (a: number, m: number) =>
  m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;

type Ctx = NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>;

/** Ventas netas y CMV estimado de un mes. */
async function ventasYCosto(ctx: Ctx, sucursalId: string, anio: number, mes: number) {
  const desde = primerDia(anio, mes);
  const hasta = primerDiaSiguiente(anio, mes);

  const ventas = await traerTodas<Record<string, unknown>>((d, h) =>
    ctx.supabase
      .from("ventas")
      .select("id, subtotal, total")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .gte("fecha", desde).lt("fecha", hasta)
      .is("anulada_at", null)
      .order("id", { ascending: true })
      .range(d, h)
  );
  const ventasNetas = ventas.reduce((s, v) => s + num(v.subtotal), 0);
  // Lo vendido es lo facturado, con IVA; el IVA de las ventas es la diferencia.
  const vendido = ventas.reduce((s, v) => s + num(v.total), 0);
  const ivaDebito = vendido - ventasNetas;
  if (ventas.length === 0) {
    return { ventas: 0, ventas_netas: 0, vendido: 0, iva_debito: 0, cmv: 0, costo: 0, iva_credito: 0, lineas: 0, lineas_sin_costo: 0 };
  }

  // Las líneas, en tandas de ids para no pasarse del largo de la URL.
  const ids = ventas.map((v) => String(v.id));
  const items: Record<string, unknown>[] = [];
  const TANDA = 100;
  for (let i = 0; i < ids.length; i += TANDA) {
    const trozo = ids.slice(i, i + TANDA);
    const parte = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("ventas_items")
        .select("producto_id, cantidad, subtotal, tipo_iva")
        .eq("empresa_id", ctx.auth.empresa_id)
        .in("venta_id", trozo)
        .order("id", { ascending: true })
        .range(d, h)
    );
    items.push(...parte);
  }

  // Costo de los artículos vendidos.
  const prodIds = [...new Set(items.map((i) => String(i.producto_id ?? "")).filter(Boolean))];
  const costos = new Map<string, { costo: number; iva: string }>();
  for (let i = 0; i < prodIds.length; i += 200) {
    const q = await ctx.supabase
      .from("productos")
      .select("id, costo_promedio, tipo_iva")
      .eq("empresa_id", ctx.auth.empresa_id)
      .in("id", prodIds.slice(i, i + 200));
    if (q.error) throw new Error(q.error.message);
    for (const p of (q.data ?? []) as Array<Record<string, unknown>>) {
      costos.set(String(p.id), {
        costo: num(p.costo_promedio),
        // La base guarda "10%" / "5%" / "EXENTA", que es lo que espera
        // `divisorIva`. El default es "10%" porque es lo que tienen 999 de los
        // 1.000 artículos: con "10" a secas caería en exenta y el costo neto
        // quedaría 10% más alto, achicando el margen sin que se note.
        iva: String(p.tipo_iva ?? "10%"),
      });
    }
  }

  let cmv = 0, costo = 0, sinCosto = 0;
  for (const it of items) {
    const info = costos.get(String(it.producto_id ?? ""));
    if (!info || info.costo <= 0) { sinCosto += 1; continue; }
    // El costo está guardado CON IVA, igual que el precio. El margen se mide
    // sobre importes netos, así que hay que sacárselo a los dos lados.
    const iva = String(it.tipo_iva ?? info.iva ?? "10%");
    cmv += num(it.cantidad) * (info.costo / divisorIva(iva));
    costo += num(it.cantidad) * info.costo;
  }

  return {
    ventas: ventas.length,
    ventas_netas: ventasNetas,
    vendido,
    iva_debito: ivaDebito,
    cmv,
    /** El costo de venta con IVA, como se compró. */
    costo,
    /** El IVA que ya se pagó al comprar lo vendido. */
    iva_credito: costo - cmv,
    lineas: items.length,
    lineas_sin_costo: sinCosto,
  };
}

/** Gastos operativos del mes: el módulo de Gastos más los egresos de caja. */
async function gastosDelMes(ctx: Ctx, sucursalId: string, anio: number, mes: number) {
  const desde = primerDia(anio, mes);
  const hasta = primerDiaSiguiente(anio, mes);

  let modulo = 0;
  try {
    const g = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("gastos")
        .select("monto")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("sucursal_id", sucursalId)
        .gte("fecha", desde).lt("fecha", hasta)
        .order("id", { ascending: true })
        .range(d, h)
    );
    modulo = g.reduce((s, x) => s + num(x.monto), 0);
  } catch { /* el módulo puede estar vacío; no rompe el cálculo */ }

  // El egreso "pago a proveedor" NO es gasto operativo: esa plata es el costo
  // de la mercadería y ya está contada en el CMV. Sumarla la contaría dos veces.
  let caja = 0;
  try {
    const m = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("caja_movimientos")
        .select("monto, tipo_egreso")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("tipo", "egreso")
        .gte("created_at", desde).lt("created_at", hasta)
        .is("anulado_at", null)
        .order("id", { ascending: true })
        .range(d, h)
    );
    caja = m
      .filter((x) => String(x.tipo_egreso ?? "") !== "proveedor")
      .reduce((s, x) => s + num(x.monto), 0);
  } catch { /* idem */ }

  return { total: modulo + caja, modulo, caja };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;
    const hoy = hoyPy();

    const anio = Number(sp.get("anio")) || hoy.anio;
    const mes = Math.min(12, Math.max(1, Number(sp.get("mes")) || hoy.mes));
    const base = mesAnterior(anio, mes);

    const [mesBase, gastosBase, mesActual] = await Promise.all([
      ventasYCosto(ctx, sucursalId, base.anio, base.mes),
      gastosDelMes(ctx, sucursalId, base.anio, base.mes),
      ventasYCosto(ctx, sucursalId, anio, mes),
    ]);

    const margen = margenDeVenta(mesBase);
    const margenCalculado = margen.margen_pct;

    // Los supuestos, que la pantalla puede pisar.
    const margenPedido = sp.get("margen");
    const gastosPedidos = sp.get("gastos");
    const margenUsado = margenPedido != null && margenPedido !== ""
      ? num(margenPedido) : margenCalculado;
    const gastosUsados = gastosPedidos != null && gastosPedidos !== ""
      ? num(gastosPedidos) : gastosBase.total;

    const resultado = calcularPuntoEquilibrio({ gastos: gastosUsados, margenPct: margenUsado });

    // El día que corre, solo si el mes pedido es el actual: para un mes pasado
    // el avance se mide con el mes completo.
    const esMesEnCurso = anio === hoy.anio && mes === hoy.mes;
    const dias = diasDelMes(anio, mes);
    const diaHoy = esMesEnCurso ? hoy.dia : dias;

    const avance = avanceDelMes({
      objetivo: resultado.ventas_necesarias,
      vendidoNeto: mesActual.vendido,
      dia: diaHoy,
      diasDelMes: dias,
    });

    return NextResponse.json(successResponse({
      periodo: { anio, mes, dias, dia_hoy: diaHoy, en_curso: esMesEnCurso },
      base: {
        anio: base.anio, mes: base.mes,
        ...mesBase,
        gastos: gastosBase.total,
        gastos_modulo: gastosBase.modulo,
        gastos_caja: gastosBase.caja,
        margen_pct: margenCalculado,
        margen,
      },
      /** true: el CMV se estimó con el costo de hoy, no con el de la venta. */
      costo_estimado: true,
      supuestos: {
        margen_pct: margenUsado,
        gastos: gastosUsados,
        margen_editado: margenPedido != null && margenPedido !== "",
        gastos_editados: gastosPedidos != null && gastosPedidos !== "",
      },
      resultado,
      actual: mesActual,
      avance,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/contabilidad/punto-equilibrio]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo calcular el punto de equilibrio."),
      { status: 500 }
    );
  }
}
