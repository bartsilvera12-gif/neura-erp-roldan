import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";
import {
  agruparPorRubro, estaBajoMinimo, resumirGrupos, type ArticuloBajoMinimo,
} from "@/lib/inventario/bajo-minimo";

/**
 * GET /api/inventario/bajo-minimo — qué reponer, por rubro.
 *
 * Los artículos cuyo stock está por debajo del mínimo cargado en su ficha,
 * agrupados por rubro, con lo que falta de cada uno y lo que cuesta reponerlo.
 *
 * La cuenta vive en `bajo-minimo.ts`, sin base de datos. Acá solo se traen las
 * filas y se arma la respuesta.
 *
 * PARÁMETROS
 *   `rubro`  — limita a un rubro.
 *   `q`      — busca por nombre o SKU.
 *   `solo`   — `sin_stock` deja únicamente los que están en cero.
 *
 * SE TRAE TODO PAGINADO
 *   Son 1.002 artículos y PostgREST corta en 1.000 sin avisar. Una lista de
 *   reposición a la que le falten los últimos dos artículos es peor que no
 *   tenerla, porque nadie va a notar cuáles faltan.
 */

type FilaProducto = {
  id: string;
  nombre: string | null;
  sku: string | null;
  unidad_medida: string | null;
  stock_actual: number | string | null;
  stock_minimo: number | string | null;
  costo_promedio: number | string | null;
  categoria_principal_id: string | null;
  controla_stock: boolean | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;

    const rubroFiltro = (sp.get("rubro") ?? "").trim();
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const soloSinStock = (sp.get("solo") ?? "") === "sin_stock";

    // ── Rubros ────────────────────────────────────────────────────────────
    const rubrosQ = await ctx.supabase
      .from("categorias_productos")
      .select("id, nombre")
      .eq("empresa_id", empresaId);
    if (rubrosQ.error) throw new Error(rubrosQ.error.message);
    const rubros = new Map<string, string>();
    for (const r of (rubrosQ.data ?? []) as Array<Record<string, unknown>>) {
      rubros.set(String(r.id), String(r.nombre ?? ""));
    }

    // ── Artículos activos que controlan stock ─────────────────────────────
    const productos = await traerTodas<FilaProducto>((d, h) =>
      ctx.supabase
        .from("productos")
        .select("id, nombre, sku, unidad_medida, stock_actual, stock_minimo, costo_promedio, categoria_principal_id, controla_stock")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .order("id", { ascending: true })
        .range(d, h)
    );

    const controlan = productos.filter((p) => p.controla_stock !== false);

    // Cuántos NO tienen mínimo cargado. Es el dato que dice hasta dónde llega
    // la lista: de esos artículos no se puede afirmar que falten.
    const sinMinimo = controlan.filter((p) => num(p.stock_minimo) <= 0).length;

    let articulos: ArticuloBajoMinimo[] = controlan
      .filter((p) => estaBajoMinimo({ stock_actual: p.stock_actual, stock_minimo: p.stock_minimo }))
      .map((p) => ({
        producto_id: String(p.id),
        nombre: String(p.nombre ?? ""),
        sku: p.sku ?? null,
        unidad: p.unidad_medida ?? null,
        stock_actual: num(p.stock_actual),
        stock_minimo: num(p.stock_minimo),
        costo_promedio: num(p.costo_promedio),
        rubro_id: p.categoria_principal_id ?? null,
        rubro_nombre: p.categoria_principal_id
          ? rubros.get(String(p.categoria_principal_id)) ?? ""
          : "",
      }));

    // Los filtros van DESPUÉS de clasificar, para que el resumen "sin filtro"
    // y el filtrado se calculen con la misma regla.
    const totalSinFiltrar = articulos.length;
    if (rubroFiltro) {
      articulos = articulos.filter((a) =>
        rubroFiltro === "__sin__" ? !a.rubro_id : a.rubro_id === rubroFiltro
      );
    }
    if (q) {
      articulos = articulos.filter(
        (a) => a.nombre.toLowerCase().includes(q) || (a.sku ?? "").toLowerCase().includes(q)
      );
    }
    if (soloSinStock) articulos = articulos.filter((a) => a.stock_actual <= 0);

    const grupos = agruparPorRubro(articulos);

    return NextResponse.json(successResponse({
      grupos,
      resumen: resumirGrupos(grupos),
      /** Artículos que controlan stock, para poder decir sobre cuántos se mira. */
      articulos_evaluados: controlan.length,
      /** De esos, cuántos no tienen mínimo cargado: la lista no los cubre. */
      sin_minimo: sinMinimo,
      /** Cuántos hay bajo mínimo en total, antes de los filtros de pantalla. */
      total_sin_filtrar: totalSinFiltrar,
      rubros: [...rubros.entries()]
        .map(([id, nombre]) => ({ id, nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    }));
  } catch (err) {
    console.error("[/api/inventario/bajo-minimo]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo armar la lista de reposición."),
      { status: 500 }
    );
  }
}
