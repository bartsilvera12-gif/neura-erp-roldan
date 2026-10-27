import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/transferencias/productos-origen?sucursal=<id>&q=<texto>
 *
 * El catálogo de la sucursal que va a DESPACHAR, con su stock.
 *
 * ── POR QUÉ NO SIRVE EL BUSCADOR DE SIEMPRE ───────────────────────────────
 *   `/api/productos/search` busca en la sucursal del que está mirando, que en
 *   una solicitud de reposición es la que PIDE. Y la que pide, cuando es nueva,
 *   no tiene nada cargado: el buscador no devuelve nada y no hay forma de
 *   armar la solicitud. Pedir repone justamente lo que no se tiene.
 *
 *   Lo que hay que ver es lo que tiene el otro, que es de donde va a salir la
 *   mercadería. Por eso esta ruta pide la sucursal explícitamente, en vez de
 *   tomarla de la sesión.
 *
 * Solo deja ver sucursales de la misma empresa: el id viaja desde el
 * navegador y no se puede confiar en él.
 */
export const dynamic = "force-dynamic";

/** Escapa % y _ para que el texto del usuario no se lea como comodín. */
function escaparIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;

    const sucursalId = (sp.get("sucursal") ?? "").trim();
    if (!sucursalId) {
      return NextResponse.json(errorResponse("Falta la sucursal de origen."), { status: 400 });
    }

    const suc = await ctx.supabase
      .from("sucursales")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", sucursalId)
      .maybeSingle();
    if (suc.error) throw new Error(suc.error.message);
    if (!suc.data) {
      return NextResponse.json(errorResponse("Esa sucursal no es de tu empresa."), { status: 403 });
    }

    const q = (sp.get("q") ?? "").trim();
    const limite = Math.min(50, Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20));

    let qb = ctx.supabase
      .from("productos")
      .select("id, nombre, sku, unidad_medida, stock_actual, precio_venta, costo_promedio")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .eq("activo", true)
      .eq("controla_stock", true)
      .order("nombre")
      .limit(limite);

    if (q) {
      const t = escaparIlike(q);
      qb = qb.or(`nombre.ilike.%${t}%,sku.ilike.%${t}%`);
    }

    const r = await qb;
    if (r.error) throw new Error(r.error.message);

    const productos = ((r.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      nombre: String(p.nombre ?? ""),
      sku: String(p.sku ?? ""),
      unidad_medida: String(p.unidad_medida ?? ""),
      stock_actual: Number(p.stock_actual) || 0,
    }));

    return NextResponse.json(successResponse({ productos }));
  } catch (err) {
    console.error("[/api/transferencias/productos-origen GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los productos de esa sucursal."), { status: 500 });
  }
}
