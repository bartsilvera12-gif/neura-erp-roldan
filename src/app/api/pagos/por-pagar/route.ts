import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/pagos/por-pagar — Cuentas por pagar a proveedores.
 * Compras con tipo_pago='credito' en estado != pagada/anulada, agrupadas por
 * numero_control (una compra = varias filas por producto).
 *
 * Filtros:
 *   ?origen=nutricion|consignataria
 *     - "nutricion" (o sin parámetro): devuelve las cuentas por pagar
 *       tradicionales (default).
 *     - "consignataria": devuelve `porPagar: []` porque las compras a
 *       proveedores son un flujo de nutrición — no aplica a la operación
 *       de consignación.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const origenRaw = sp.get("origen");
    const origen: "nutricion" | "consignataria" | null =
      origenRaw === "nutricion" || origenRaw === "consignataria" ? origenRaw : null;

    // En modo consignataria no hay "por pagar" — las compras siempre son del
    // flujo de nutrición. Devolvemos lista vacía para simplificar la UI.
    if (origen === "consignataria") {
      return NextResponse.json(successResponse({ porPagar: [] }));
    }

    const { data, error } = await ctx.supabase
      .from("compras")
      .select("id, numero_control, proveedor_id, proveedor_nombre, fecha, fecha_factura, plazo_dias, total, estado, tipo_pago, moneda")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("tipo_pago", "credito")
      .not("estado", "in", '("pagada","anulada")')
      .order("fecha", { ascending: false });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    // Agrupar por numero_control (una compra = N filas)
    type Row = {
      id: string; numero_control: string; proveedor_id: string; proveedor_nombre: string;
      fecha: string; fecha_factura: string | null; plazo_dias: number | null;
      total: number; estado: string; moneda: string;
    };
    const map = new Map<string, Row & { items: number }>();
    const rows = (data ?? []) as Array<{
      id: string; numero_control: string; proveedor_id: string; proveedor_nombre: string;
      fecha: string; fecha_factura: string | null; plazo_dias: number | null;
      total: number; estado: string; moneda: string;
    }>;
    for (const r of rows) {
      const key = r.numero_control || r.id;
      const existing = map.get(key);
      if (existing) {
        existing.total += Number(r.total) || 0;
        existing.items += 1;
      } else {
        map.set(key, {
          id: r.id,
          numero_control: r.numero_control,
          proveedor_id: r.proveedor_id,
          proveedor_nombre: r.proveedor_nombre,
          fecha: r.fecha,
          fecha_factura: r.fecha_factura,
          plazo_dias: r.plazo_dias,
          total: Number(r.total) || 0,
          estado: r.estado,
          moneda: r.moneda ?? "PYG",
          items: 1,
        });
      }
    }

    // Notas de crédito de compra: reducen lo que se debe por cada numero_control.
    // Best-effort: si la tabla aún no existe, se ignora sin romper el listado.
    const ncPorCompra = new Map<string, number>();
    try {
      const ncQ = await ctx.supabase
        .from("notas_credito_compra")
        .select("compra_numero_control, monto")
        .eq("empresa_id", ctx.auth.empresa_id);
      for (const r of (ncQ.data ?? []) as Array<{ compra_numero_control: string | null; monto: number | string }>) {
        const key = r.compra_numero_control ?? "";
        if (!key) continue;
        ncPorCompra.set(key, (ncPorCompra.get(key) ?? 0) + (Number(r.monto) || 0));
      }
    } catch {
      /* tabla notas_credito_compra inexistente todavía */
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const porPagar = Array.from(map.values())
      .map((c) => {
        let fecha_vencimiento: string | null = null;
        let vencida = false;
        if (c.fecha_factura && c.plazo_dias != null && c.plazo_dias > 0) {
          const d = new Date(c.fecha_factura + "T00:00:00");
          d.setDate(d.getDate() + c.plazo_dias);
          fecha_vencimiento = d.toISOString().slice(0, 10);
          vencida = d.getTime() < hoy.getTime();
        }
        const nc = ncPorCompra.get(c.numero_control) ?? 0;
        const totalBruto = c.total;
        const totalNeto = Math.max(0, totalBruto - nc);
        return { ...c, total: totalNeto, total_bruto: totalBruto, nc_aplicado: nc, fecha_vencimiento, vencida };
      })
      // Compras totalmente cubiertas por notas de crédito ya no se deben.
      .filter((c) => c.total > 0);

    return NextResponse.json(successResponse({ porPagar }));
  } catch (err) {
    console.error("[/api/pagos/por-pagar GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al listar cuentas por pagar"), { status: 500 });
  }
}
