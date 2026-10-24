import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/inventario/sugerencias?dias=60&cobertura=30
 *
 * Reposición: cuánto se consumió, cuánto queda y cuánto conviene comprar.
 *
 * CÓMO SE CALCULA
 *   consumo diario = unidades que salieron en la ventana / días de la ventana
 *   días de cobertura = stock actual / consumo diario
 *   sugerido = consumo diario × días objetivo − stock actual
 *
 *   El consumo sale de los movimientos de tipo SALIDA, que es lo que
 *   efectivamente se fue del depósito. No se usan las ventas: un producto
 *   puede salir por devolución a proveedor, rotura o consumo interno, y para
 *   reponer lo que importa es que se fue, no por qué.
 *
 *   Las transferencias entre depósitos se excluyen: mueven stock de lugar,
 *   no lo consumen. Contarlas inflaría el consumo y haría comprar de más.
 *
 * PARÁMETROS
 *   `dias`      — ventana de análisis del consumo (default 60).
 *   `cobertura` — para cuántos días se quiere tener stock (default 30).
 */

const DIAS_DEFAULT = 60;
const COBERTURA_DEFAULT = 30;

type Fila = {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  stock_actual: number;
  stock_minimo: number;
  costo_promedio: number;
  proveedor_principal_id: string | null;
  proveedor_nombre: string | null;
  /** Unidades que salieron en la ventana. */
  consumo_periodo: number;
  consumo_diario: number;
  /** Días que aguanta el stock actual al ritmo de consumo. null = no se consume. */
  dias_cobertura: number | null;
  sugerido: number;
  costo_sugerido: number;
  estado: "sin_stock" | "critico" | "bajo" | "ok" | "sin_consumo";
};

function entero(v: string | null, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const dias = entero(sp.get("dias"), DIAS_DEFAULT, 7, 365);
    const cobertura = entero(sp.get("cobertura"), COBERTURA_DEFAULT, 1, 365);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

    // ── Productos que controlan stock ─────────────────────────────────────
    const prodQ = await ctx.supabase
      .from("productos")
      .select("id, nombre, sku, unidad_medida, stock_actual, stock_minimo, costo_promedio, proveedor_principal_id, controla_stock, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true);
    if (prodQ.error) throw new Error(prodQ.error.message);

    const productos = ((prodQ.data ?? []) as Array<Record<string, unknown>>)
      .filter((p) => p.controla_stock !== false);
    if (productos.length === 0) {
      return NextResponse.json(successResponse({ dias, cobertura, filas: [], resumen: vacio() }));
    }

    // ── Consumo: salidas de la ventana ────────────────────────────────────
    const movQ = await ctx.supabase
      .from("movimientos_inventario")
      .select("producto_id, cantidad, tipo, origen")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .eq("tipo", "SALIDA")
      .gte("fecha", desde);
    if (movQ.error) throw new Error(movQ.error.message);

    const consumoPorProducto = new Map<string, number>();
    for (const m of (movQ.data ?? []) as Array<Record<string, unknown>>) {
      // Una transferencia mueve stock de depósito, no lo consume.
      if (String(m.origen ?? "") === "transferencia") continue;
      const id = String(m.producto_id ?? "");
      if (!id) continue;
      consumoPorProducto.set(id, (consumoPorProducto.get(id) ?? 0) + (Number(m.cantidad) || 0));
    }

    // ── Nombre del proveedor, para saber a quién pedirle ──────────────────
    const provIds = [...new Set(
      productos.map((p) => String(p.proveedor_principal_id ?? "")).filter(Boolean)
    )];
    const nombreProv = new Map<string, string>();
    if (provIds.length > 0) {
      const pv = await ctx.supabase
        .from("proveedores").select("id, nombre")
        .eq("empresa_id", empresaId).in("id", provIds);
      for (const p of (pv.data ?? []) as Array<Record<string, unknown>>) {
        nombreProv.set(String(p.id), String(p.nombre ?? ""));
      }
    }

    const filas: Fila[] = productos.map((p) => {
      const id = String(p.id);
      const stock = Number(p.stock_actual) || 0;
      const minimo = Number(p.stock_minimo) || 0;
      const consumo = consumoPorProducto.get(id) ?? 0;
      const consumoDiario = consumo / dias;

      const diasCobertura = consumoDiario > 0 ? stock / consumoDiario : null;

      // Objetivo: tener para `cobertura` días. Nunca por debajo del mínimo.
      const objetivo = Math.max(consumoDiario * cobertura, minimo);
      const sugerido = Math.max(0, Math.ceil(objetivo - stock));

      const estado: Fila["estado"] =
        stock <= 0 ? "sin_stock"
        : consumoDiario <= 0 ? "sin_consumo"
        : diasCobertura != null && diasCobertura < cobertura / 3 ? "critico"
        : (minimo > 0 && stock <= minimo) || (diasCobertura != null && diasCobertura < cobertura) ? "bajo"
        : "ok";

      const costo = Number(p.costo_promedio) || 0;
      return {
        producto_id: id,
        nombre: String(p.nombre ?? ""),
        sku: p.sku == null ? null : String(p.sku),
        unidad: p.unidad_medida == null ? null : String(p.unidad_medida),
        stock_actual: stock,
        stock_minimo: minimo,
        costo_promedio: costo,
        proveedor_principal_id: p.proveedor_principal_id == null ? null : String(p.proveedor_principal_id),
        proveedor_nombre: nombreProv.get(String(p.proveedor_principal_id ?? "")) ?? null,
        consumo_periodo: consumo,
        consumo_diario: consumoDiario,
        dias_cobertura: diasCobertura,
        sugerido,
        costo_sugerido: sugerido * costo,
        estado,
      };
    });

    // Lo urgente primero: sin stock, después crítico, después bajo.
    const orden = { sin_stock: 0, critico: 1, bajo: 2, sin_consumo: 3, ok: 4 };
    filas.sort((a, b) =>
      orden[a.estado] - orden[b.estado] ||
      (a.dias_cobertura ?? 1e9) - (b.dias_cobertura ?? 1e9) ||
      a.nombre.localeCompare(b.nombre, "es")
    );

    const resumen = {
      productos: filas.length,
      sin_stock: filas.filter((f) => f.estado === "sin_stock").length,
      criticos: filas.filter((f) => f.estado === "critico").length,
      bajos: filas.filter((f) => f.estado === "bajo").length,
      a_reponer: filas.filter((f) => f.sugerido > 0).length,
      costo_total: filas.reduce((s, f) => s + f.costo_sugerido, 0),
    };

    return NextResponse.json(successResponse({ dias, cobertura, filas, resumen }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/sugerencias]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo calcular la reposición."),
      { status: 500 }
    );
  }
}

function vacio() {
  return { productos: 0, sin_stock: 0, criticos: 0, bajos: 0, a_reponer: 0, costo_total: 0 };
}
