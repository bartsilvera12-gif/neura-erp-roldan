import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";


/**
 * GET /api/facturas/[id]
 * Factura de la empresa autenticada + texto corto del cliente (para UI).
 *
 * Usa el helper de facturación (PG shim para tenants `erp_*` no expuestos en PostgREST,
 * service role estándar para `zentra_erp` y legacy). Antes usaba `getTenantSupabaseFromAuth`,
 * que devolvía `PGRST106 Invalid schema` para schemas `erp_*`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id } = await params;
    const fid = id?.trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }


    const { data: factura, error: errF } = await supabase
      .from("facturas")
      .select("*")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const row = factura as { cliente_id: string };
    // Datos del cliente para la cabecera. nombre_comercial es opcional (columna
    // nueva): si el tenant no la tiene, se reintenta sin ella.
    let cliData: Record<string, unknown> | null = null;
    {
      const r1 = await supabase
        .from("clientes")
        .select("nombre_contacto, empresa, nombre_comercial")
        .eq("id", row.cliente_id)
        .maybeSingle();
      if (r1.error) {
        const r2 = await supabase
          .from("clientes")
          .select("nombre_contacto, empresa")
          .eq("id", row.cliente_id)
          .maybeSingle();
        cliData = (r2.data ?? null) as Record<string, unknown> | null;
      } else {
        cliData = (r1.data ?? null) as Record<string, unknown> | null;
      }
    }

    const empresa = String(cliData?.empresa ?? "").trim();
    const nombre = String(cliData?.nombre_contacto ?? "").trim();
    const cliente_display = empresa || nombre || "Cliente";
    const cliente_sucursal = String(cliData?.nombre_comercial ?? "").trim() || null;

    // Detalle de productos de la factura (línea por línea). No es fiscal: es el
    // mismo detalle que ya se usa para el KUDE. Si falla, la ficha se muestra
    // igual sin la tabla.
    const { data: itemsData } = await supabase
      .from("factura_items")
      .select("descripcion, cantidad, precio_unitario, subtotal, iva, total")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: true });
    const items = ((itemsData ?? []) as unknown[]).map((raw) => {
      const it = raw as Record<string, unknown>;
      const num = (v: unknown): number | null => (v == null ? null : Number(v));
      return {
        descripcion: it.descripcion == null ? null : String(it.descripcion),
        cantidad: num(it.cantidad),
        precio_unitario: num(it.precio_unitario),
        subtotal: num(it.subtotal),
        iva: num(it.iva),
        total: num(it.total),
      };
    });

    return NextResponse.json(
      successResponse({
        ...factura,
        cliente_display,
        cliente_sucursal,
        items,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
