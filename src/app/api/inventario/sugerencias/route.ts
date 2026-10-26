import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { minimosSugeridosOVacio, MESES_VENTANA } from "@/lib/inventario/server/stock-minimo-pg";

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
 * UMBRAL CRÍTICO POR RUBRO (punto 1.3)
 *   Cada rubro puede tener su propio `dias_critico`: los días de stock por
 *   debajo de los cuales se marca crítico. En la práctica es lo que tarda
 *   reponerlo — la chapa quince días, el tornillo cinco — así que un umbral
 *   único para toda la empresa deja sobrando de lo que llega rápido y
 *   faltando de lo que tarda.
 *
 *   El rubro que no lo tenga configurado usa el umbral general: un tercio de
 *   la cobertura pedida, que es lo que hacía antes para todos.
 *
 * MÍNIMO SUGERIDO (punto 1.2)
 *   Aparte del consumo, cada fila trae el mínimo sugerido: la MEDIANA de lo
 *   vendido por mes en los últimos seis meses cerrados. Es un número distinto
 *   del consumo diario y responde otra pregunta — no "cuánto compro ahora"
 *   sino "cuánto no debería bajar nunca".
 *
 *   Se calcula con el pool directo. Si no está disponible, las filas salen con
 *   `minimo_sugerido: null` y la pantalla sigue funcionando: es información
 *   extra, no la base del resto del cálculo.
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
  /** Mediana de ventas mensuales de los últimos 6 meses. null = no se pudo calcular. */
  minimo_sugerido: number | null;
  /** El mejor mes de la ventana. Explica una mediana que parece baja. */
  pico_mes: number | null;
  /** Cuántos de los 6 meses tuvieron al menos una venta. */
  meses_con_venta: number | null;
  rubro_nombre: string | null;
  /** Días bajo los cuales este producto es crítico. */
  dias_critico: number;
  /** true si ese umbral vino del rubro; false si es el general. */
  critico_del_rubro: boolean;
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
    // Mínimo sugerido por mediana de ventas (punto 1.2). No bloquea: si falla
    // el pool, el resto de la pantalla igual tiene que abrir.
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const minimos = await minimosSugeridosOVacio(schema, empresaId, sucursalId);

    const prodQ = await ctx.supabase
      .from("productos")
      .select("id, nombre, sku, unidad_medida, stock_actual, stock_minimo, costo_promedio, proveedor_principal_id, controla_stock, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true);
    if (prodQ.error) throw new Error(prodQ.error.message);

    const productos = ((prodQ.data ?? []) as Array<Record<string, unknown>>)
      .filter((p) => p.controla_stock !== false);
    if (productos.length === 0) {
      return NextResponse.json(successResponse({
        dias, cobertura, filas: [], resumen: vacio(),
        meses_minimo: MESES_VENTANA, minimos_disponibles: false, rubros_con_umbral: 0,
      }));
    }

    // ── Umbral crítico por rubro (punto 1.3) ──────────────────────────────
    // Si el script 18 todavía no corrió, la consulta falla por la columna que
    // falta: se reintenta sin ella y todos los rubros caen al umbral general.
    const rubros = new Map<string, { nombre: string; dias_critico: number | null }>();
    {
      // El `select` de supabase-js se tipa desde el literal, así que no puede
      // salir de un ternario: van dos llamadas separadas.
      const conDias = await ctx.supabase
        .from("categorias_productos")
        .select("id, nombre, dias_critico")
        .eq("empresa_id", empresaId);
      let data: unknown[] = conDias.data ?? [];
      if (conDias.error) {
        if (!/dias_critico/.test(conDias.error.message ?? "")) {
          throw new Error(conDias.error.message);
        }
        const sinDias = await ctx.supabase
          .from("categorias_productos")
          .select("id, nombre")
          .eq("empresa_id", empresaId);
        if (sinDias.error) throw new Error(sinDias.error.message);
        data = sinDias.data ?? [];
      }
      for (const c of data as Array<Record<string, unknown>>) {
        const d = Number(c.dias_critico);
        rubros.set(String(c.id), {
          nombre: String(c.nombre ?? ""),
          dias_critico: Number.isFinite(d) && d > 0 ? d : null,
        });
      }
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

      const rubro = rubros.get(String(p.categoria_principal_id ?? ""));
      // El umbral del rubro manda; si no tiene, el general de siempre.
      const criticoDelRubro = rubro?.dias_critico != null;
      const diasCritico = rubro?.dias_critico ?? cobertura / 3;

      const estado: Fila["estado"] =
        stock <= 0 ? "sin_stock"
        : consumoDiario <= 0 ? "sin_consumo"
        : diasCobertura != null && diasCobertura < diasCritico ? "critico"
        : (minimo > 0 && stock <= minimo) || (diasCobertura != null && diasCobertura < cobertura) ? "bajo"
        : "ok";

      const costo = Number(p.costo_promedio) || 0;
      const m = minimos.get(id);
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
        minimo_sugerido: m ? Math.ceil(m.mediana) : null,
        pico_mes: m ? m.pico : null,
        meses_con_venta: m ? m.meses_con_venta : null,
        rubro_nombre: rubro?.nombre ?? null,
        dias_critico: diasCritico,
        critico_del_rubro: criticoDelRubro,
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
      // Cuántos tienen un mínimo sugerido distinto del cargado hoy.
      minimos_a_actualizar: filas.filter(
        (f) => f.minimo_sugerido != null && f.minimo_sugerido !== f.stock_minimo
      ).length,
    };

    return NextResponse.json(successResponse({
      dias, cobertura, filas, resumen,
      meses_minimo: MESES_VENTANA,
      minimos_disponibles: minimos.size > 0,
      rubros_con_umbral: [...rubros.values()].filter((r) => r.dias_critico != null).length,
    }));
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
  return { productos: 0, sin_stock: 0, criticos: 0, bajos: 0, a_reponer: 0, costo_total: 0, minimos_a_actualizar: 0 };
}
