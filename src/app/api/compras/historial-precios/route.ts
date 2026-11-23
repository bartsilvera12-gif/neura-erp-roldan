import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { FilaHistorial } from "@/lib/compras/historial-precios";

export const dynamic = "force-dynamic";

/**
 * GET /api/compras/historial-precios?producto_id=…&desde=…&hasta=…
 *
 * A cuánto se compró un artículo cada vez (pedido del cliente). Devuelve una
 * fila por compra, de la más nueva a la más vieja, con proveedor, factura,
 * cantidad, precio en guaraníes, precio en la moneda de esa compra y total.
 *
 * Solo lee. Las compras anuladas NO salen: se revirtieron, su precio no es un
 * precio que se haya pagado.
 *
 * `desde` y `hasta` son opcionales (YYYY-MM-DD) y se comparan contra `fecha`,
 * que es cuándo se registró la compra.
 */
const LIMITE = 500;
const fechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const productoId = (sp.get("producto_id") ?? "").trim();
    if (!productoId) {
      return NextResponse.json(errorResponse("Elegí el artículo."), { status: 400 });
    }
    const desde = (sp.get("desde") ?? "").trim();
    const hasta = (sp.get("hasta") ?? "").trim();
    if (desde && !fechaValida(desde)) {
      return NextResponse.json(errorResponse("La fecha «desde» no es válida."), { status: 400 });
    }
    if (hasta && !fechaValida(hasta)) {
      return NextResponse.json(errorResponse("La fecha «hasta» no es válida."), { status: 400 });
    }
    if (desde && hasta && desde > hasta) {
      return NextResponse.json(errorResponse("«Desde» no puede ser posterior a «hasta»."), { status: 400 });
    }

    let q = ctx.supabase
      .from("compras")
      .select(
        "numero_control, fecha, producto_id, producto_nombre, proveedor_nombre, numero_factura, cantidad, costo_unitario, costo_unitario_original, moneda, tipo_cambio, total"
      )
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", productoId)
      .neq("estado", "anulada");
    if (desde) q = q.gte("fecha", desde);
    // `fecha` puede traer hora: sin el día siguiente, «hasta» dejaría afuera
    // las compras del propio día que se pidió.
    if (hasta) q = q.lt("fecha", `${hasta}T23:59:59.999Z`);

    const { data, error } = await q.order("fecha", { ascending: false }).limit(LIMITE);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });

    const filas = (data ?? []) as unknown as FilaHistorial[];
    return NextResponse.json(successResponse({
      filas,
      // Para poder decir «son las últimas 500» en vez de dar a entender que es todo.
      tope: filas.length >= LIMITE,
      limite: LIMITE,
    }));
  } catch (err) {
    console.error("[/api/compras/historial-precios]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo leer el historial."), { status: 500 });
  }
}
