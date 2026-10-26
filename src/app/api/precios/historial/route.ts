import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/precios/historial — qué precios se cambiaron, cuándo y quién
 * (requisito 11.3).
 *
 *   ?producto=<uuid>  → la historia de un producto
 *   ?desde= &hasta=   → por fecha
 *   sin filtros       → los últimos cambios, agrupados por lote
 *
 * ── SE AGRUPA POR LOTE ────────────────────────────────────────────────────
 *   Un cambio masivo deja una fila por producto. Listarlas sueltas convierte
 *   un evento —"el 12 de octubre se subió todo Electricidad un 8%"— en
 *   trescientas líneas iguales. Agrupadas, se lee lo que realmente pasó y, si
 *   hace falta, se abre el detalle.
 */

const FALTA_TABLA = "Falta correr 29_historial_precios.sql en la base.";
const esTablaFaltante = (m: string) =>
  /precios_historial/.test(m) && /(does not exist|schema cache|PGRST205)/i.test(m);

const OFFSET_PY = "-03:00";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    let qb = ctx.supabase
      .from("precios_historial")
      .select("id, producto_id, producto_nombre, producto_sku, precio_anterior, precio_nuevo, modo, valor, redondeo, lote, usuario_nombre, creado_at")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId);

    const producto = (sp.get("producto") ?? "").trim();
    if (producto) qb = qb.eq("producto_id", producto);
    const desde = sp.get("desde");
    const hasta = sp.get("hasta");
    if (desde && RE_FECHA.test(desde)) qb = qb.gte("creado_at", `${desde}T00:00:00${OFFSET_PY}`);
    if (hasta && RE_FECHA.test(hasta)) qb = qb.lte("creado_at", `${hasta}T23:59:59.999${OFFSET_PY}`);

    const r = await qb.order("creado_at", { ascending: false }).limit(1000);
    if (r.error) {
      if (esTablaFaltante(r.error.message ?? "")) {
        // Sin la tabla, el estudio de precios sigue funcionando: lo único que
        // falta es el historial, y avisar es mejor que romper la pantalla.
        return NextResponse.json(successResponse({ cambios: [], lotes: [], migrado: false, aviso: FALTA_TABLA }));
      }
      throw new Error(r.error.message);
    }

    const cambios = ((r.data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => ({
      id: String(c.id),
      producto_id: String(c.producto_id),
      producto_nombre: String(c.producto_nombre ?? ""),
      producto_sku: String(c.producto_sku ?? ""),
      precio_anterior: Number(c.precio_anterior) || 0,
      precio_nuevo: Number(c.precio_nuevo) || 0,
      modo: c.modo == null ? null : String(c.modo),
      valor: c.valor == null ? null : Number(c.valor),
      lote: c.lote == null ? null : String(c.lote),
      usuario_nombre: c.usuario_nombre == null ? null : String(c.usuario_nombre),
      creado_at: String(c.creado_at ?? ""),
    }));

    // Un evento por lote. Los cambios sin lote (de a uno) son su propio lote.
    const lotes = new Map<string, {
      lote: string | null; creado_at: string; usuario_nombre: string | null;
      modo: string | null; valor: number | null; productos: number;
      suben: number; bajan: number;
    }>();
    for (const c of cambios) {
      const k = c.lote ?? `__${c.id}`;
      const a = lotes.get(k) ?? {
        lote: c.lote, creado_at: c.creado_at, usuario_nombre: c.usuario_nombre,
        modo: c.modo, valor: c.valor, productos: 0, suben: 0, bajan: 0,
      };
      a.productos += 1;
      if (c.precio_nuevo > c.precio_anterior) a.suben += 1;
      else if (c.precio_nuevo < c.precio_anterior) a.bajan += 1;
      lotes.set(k, a);
    }

    return NextResponse.json(successResponse({
      cambios,
      lotes: [...lotes.values()].sort((a, b) => b.creado_at.localeCompare(a.creado_at)),
      migrado: true,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/precios/historial]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de precios."), { status: 500 });
  }
}
