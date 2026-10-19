import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/ventas/[id]/facturar
 *
 * Emite la FACTURA ERP (FAC-XXXXXX) para una venta que todavía no la tiene —
 * típicamente una venta de CONSIGNACIÓN (origen='consignacion'), que se crea
 * como ticket y factura la comisión aparte. Replica el "puente venta→factura"
 * de create-venta-pg: crea `facturas` + `factura_items` y linkea
 * `ventas.factura_id`. Después, el detalle /facturas/[id] emite el DE por SIFEN.
 *
 * Idempotente: si la venta ya tiene factura, devuelve esa.
 */
export const dynamic = "force-dynamic";

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = ctx.auth.sucursal_id ?? null;

    // 1) Venta.
    const vQ = await ctx.supabase
      .from("ventas")
      .select("id, cliente_id, tipo_venta, total, moneda, observaciones, fecha, factura_id, estado")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (vQ.error) throw new Error(vQ.error.message);
    if (!vQ.data) return NextResponse.json(errorResponse("Venta no encontrada"), { status: 404 });
    const v = vQ.data as {
      cliente_id: string | null; tipo_venta: string | null; total: number | null;
      moneda: string | null; observaciones: string | null; fecha: string; factura_id: string | null; estado: string | null;
    };
    if (v.estado === "anulada") {
      return NextResponse.json(errorResponse("La venta está anulada; no se puede facturar."), { status: 409 });
    }
    // Idempotente: ya tiene factura.
    if (v.factura_id) {
      return NextResponse.json(successResponse({ factura_id: v.factura_id, ya_existia: true }));
    }

    // 2) Ítems de la venta → factura_items.
    const iQ = await ctx.supabase
      .from("ventas_items")
      .select("producto_nombre, cantidad, precio_venta, subtotal, monto_iva, tipo_iva, total_linea")
      .eq("empresa_id", empresaId)
      .eq("venta_id", id);
    if (iQ.error) throw new Error(iQ.error.message);
    const items = (iQ.data ?? []) as Array<Record<string, unknown>>;
    if (items.length === 0) {
      return NextResponse.json(errorResponse("La venta no tiene líneas para facturar."), { status: 400 });
    }

    // 3) Razón social / RUC: de la ficha del cliente; si no hay, se intenta leer
    //    de observaciones ("Facturar a: X — RUC Y", que deja la consignación).
    let razonSocial: string | null = null;
    let rucSnap: string | null = null;
    if (v.cliente_id) {
      const cQ = await ctx.supabase
        .from("clientes")
        .select("nombre_facturacion, empresa, nombre_contacto, nombre, ruc")
        .eq("empresa_id", empresaId)
        .eq("id", v.cliente_id)
        .maybeSingle();
      const c = cQ.data as Record<string, string | null> | null;
      if (c) {
        razonSocial = s(c.nombre_facturacion) || s(c.empresa) || s(c.nombre_contacto) || s(c.nombre);
        rucSnap = s(c.ruc);
      }
    }
    if (!rucSnap && v.observaciones) {
      const mRuc = /RUC\s*([\d-]+)/i.exec(v.observaciones);
      if (mRuc) rucSnap = mRuc[1];
    }

    // 4) Próximo FAC-XXXXXX (misma serie que el puente).
    const maxQ = await ctx.supabase
      .from("facturas")
      .select("numero_factura")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .like("numero_factura", "FAC-%")
      .order("numero_factura", { ascending: false })
      .limit(1);
    let nextNum = 1;
    const prevRaw = Array.isArray(maxQ.data) && maxQ.data.length > 0
      ? (maxQ.data[0] as { numero_factura?: string }).numero_factura
      : null;
    if (typeof prevRaw === "string") {
      const m = /^FAC-(\d+)$/.exec(prevRaw.trim());
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    const numeroFactura = `FAC-${String(nextNum).padStart(6, "0")}`;

    const esCredito = v.tipo_venta === "CREDITO";
    const total = num(v.total);
    const fechaDia = String(v.fecha).slice(0, 10);

    // 5) Insert facturas.
    const insFac = await ctx.supabase
      .from("facturas")
      .insert({
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        cliente_id: v.cliente_id ?? null,
        numero_factura: numeroFactura,
        fecha: fechaDia,
        fecha_vencimiento: fechaDia,
        monto: total,
        saldo: esCredito ? total : 0,
        estado: esCredito ? "Pendiente" : "Pagado",
        tipo: esCredito ? "credito" : "contado",
        moneda: v.moneda === "USD" ? "USD" : "GS",
        cliente_razon_social: razonSocial,
        cliente_ruc: rucSnap,
        observaciones: v.observaciones,
        origen_venta_id: id,
      })
      .select("id")
      .single();
    if (insFac.error) throw new Error(insFac.error.message);
    const facturaId = String((insFac.data as { id: string }).id);

    // 6) factura_items.
    const insItems = await ctx.supabase.from("factura_items").insert(
      items.map((line) => ({
        empresa_id: empresaId,
        factura_id: facturaId,
        descripcion: s(line.producto_nombre) ?? "Comisión",
        cantidad: num(line.cantidad) || 1,
        precio_unitario: num(line.precio_venta),
        subtotal: num(line.subtotal),
        iva: num(line.monto_iva),
        tipo_iva: s(line.tipo_iva) ?? "10%",
        total: num(line.total_linea),
      }))
    );
    if (insItems.error) throw new Error(insItems.error.message);

    // 7) Link venta → factura.
    const linkUpd = await ctx.supabase
      .from("ventas")
      .update({ factura_id: facturaId })
      .eq("id", id)
      .eq("empresa_id", empresaId);
    if (linkUpd.error) throw new Error(linkUpd.error.message);

    return NextResponse.json(successResponse({ factura_id: facturaId, numero_factura: numeroFactura }));
  } catch (err) {
    console.error("[/api/ventas/[id]/facturar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo emitir la factura de la venta."), { status: 500 });
  }
}
