import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";

/**
 * Orden de pago CONSOLIDADA: varias facturas de un proveedor en un cheque.
 *
 * GET ?proveedor_id=…  — las facturas pendientes de ese proveedor, para elegir
 *                        cuáles entran en el pago.
 * GET ?cheque_id=…     — un pago ya armado: su cheque, sus facturas y su recibo.
 *
 * ── LO QUE YA ESTABA Y LO QUE NO ───────────────────────────────────────────
 *   El modelo ya permitía que un cheque cubriera varias facturas
 *   (`cheque_compras`). Lo que no había era forma de armarlo salvo desde UNA
 *   celda del flujo de caja —un proveedor, un día— y en la práctica las
 *   facturas que se pagan juntas vencen en días distintos.
 *
 * ── QUÉ CUENTA COMO PENDIENTE ──────────────────────────────────────────────
 *   A crédito, no anulada, no pagada, y SIN cheque que ya la cubra. Lo último
 *   es lo que evita pagar dos veces la misma factura, que es el error caro.
 */

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** fecha_factura + plazo_dias, sin pasar por zonas horarias. */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;
    const chequeId = (sp.get("cheque_id") ?? "").trim();
    const proveedorId = (sp.get("proveedor_id") ?? "").trim();

    // ── Un pago ya armado ─────────────────────────────────────────────────
    if (chequeId) {
      return NextResponse.json(successResponse(await detalleDelPago(ctx, chequeId)));
    }

    if (!proveedorId) {
      return NextResponse.json(errorResponse("Elegí el proveedor."), { status: 400 });
    }

    // ── Facturas pendientes del proveedor ─────────────────────────────────
    const filas = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("compras")
        .select("numero_control, numero_factura, fecha, fecha_factura, plazo_dias, total, moneda, estado, tipo_pago")
        .eq("empresa_id", empresaId)
        .eq("proveedor_id", proveedorId)
        .eq("tipo_pago", "credito")
        .or("estado.is.null,and(estado.neq.anulada,estado.neq.pagada)")
        .order("numero_control", { ascending: true })
        .range(d, h)
    );

    // Una factura son varias filas (una por ítem): el total es la suma.
    const porFactura = new Map<string, {
      numero_control: string; numero_factura: string | null;
      fecha: string | null; vencimiento: string | null; moneda: string; total: number;
    }>();
    for (const r of filas) {
      const nc = String(r.numero_control ?? "");
      if (!nc) continue;
      let f = porFactura.get(nc);
      if (!f) {
        const base = String(r.fecha_factura ?? r.fecha ?? "").slice(0, 10);
        const plazo = r.plazo_dias == null ? null : Number(r.plazo_dias);
        f = {
          numero_control: nc,
          numero_factura: r.numero_factura == null ? null : String(r.numero_factura),
          fecha: base || null,
          vencimiento: base && plazo != null ? sumarDias(base, plazo) : null,
          moneda: String(r.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG",
          total: 0,
        };
        porFactura.set(nc, f);
      }
      f.total += num(r.total);
    }

    // ── Las que ya tienen cheque quedan afuera ────────────────────────────
    // Sin esto se podría armar un segundo pago por una factura ya pagada, que
    // es exactamente el error que este módulo existe para evitar.
    const numeros = [...porFactura.keys()];
    const yaCubiertas = new Set<string>();
    if (numeros.length > 0) {
      for (let i = 0; i < numeros.length; i += 200) {
        const q = await ctx.supabase
          .from("cheque_compras")
          .select("compra_numero_control, cheque_id")
          .eq("empresa_id", empresaId)
          .in("compra_numero_control", numeros.slice(i, i + 200));
        if (q.error) throw new Error(q.error.message);
        for (const r of (q.data ?? []) as Array<Record<string, unknown>>) {
          yaCubiertas.add(String(r.compra_numero_control ?? ""));
        }
      }
    }

    const hoy = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const pendientes = [...porFactura.values()]
      .filter((f) => !yaCubiertas.has(f.numero_control))
      .map((f) => ({
        ...f,
        vencida: Boolean(f.vencimiento && f.vencimiento < hoy),
      }))
      .sort((a, b) => (a.vencimiento ?? "9999").localeCompare(b.vencimiento ?? "9999"));

    return NextResponse.json(successResponse({
      facturas: pendientes,
      con_cheque: yaCubiertas.size,
      total_pendiente: pendientes.reduce((s, f) => s + f.total, 0),
    }));
  } catch (err) {
    console.error("[/api/pagos/orden-pago]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar las facturas del proveedor."),
      { status: 500 }
    );
  }
}

type Ctx = NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>;

/** Cheque + facturas que cubre + recibo. Lo que se imprime y lo que se muestra. */
async function detalleDelPago(ctx: Ctx, chequeId: string) {
  const empresaId = ctx.auth.empresa_id;

  // Las columnas del recibo las agrega el script 70: si no está, se reintenta
  // sin ellas para que la pantalla funcione igual.
  let cheque: Record<string, unknown> | null = null;
  let hayRecibo = true;
  const conRecibo = await ctx.supabase
    .from("cheques")
    .select("id, numero, numero_recibo, fecha_recibo, recibo_storage_path, recibo_nombre, banco_nombre, moneda, importe, estado, fecha_emision, fecha_pago_prevista, proveedor_id, proveedor_nombre, observacion")
    .eq("empresa_id", empresaId).eq("id", chequeId).maybeSingle();
  if (conRecibo.error) {
    if (!/recibo|numero_recibo|fecha_recibo/.test(conRecibo.error.message)) {
      throw new Error(conRecibo.error.message);
    }
    hayRecibo = false;
    const sin = await ctx.supabase
      .from("cheques")
      .select("id, numero, banco_nombre, moneda, importe, estado, fecha_emision, fecha_pago_prevista, proveedor_id, proveedor_nombre, observacion")
      .eq("empresa_id", empresaId).eq("id", chequeId).maybeSingle();
    if (sin.error) throw new Error(sin.error.message);
    cheque = sin.data as Record<string, unknown> | null;
  } else {
    cheque = conRecibo.data as Record<string, unknown> | null;
  }
  if (!cheque) throw new Error("Cheque no encontrado.");

  const ccQ = await ctx.supabase
    .from("cheque_compras")
    .select("compra_numero_control, importe_imputado")
    .eq("empresa_id", empresaId).eq("cheque_id", chequeId).limit(500);
  if (ccQ.error) throw new Error(ccQ.error.message);
  const imputadas = (ccQ.data ?? []) as Array<Record<string, unknown>>;
  const numeros = imputadas.map((r) => String(r.compra_numero_control ?? "")).filter(Boolean);

  const detalle = new Map<string, { numero_factura: string | null; fecha: string | null; total: number }>();
  if (numeros.length > 0) {
    const q = await ctx.supabase
      .from("compras")
      .select("numero_control, numero_factura, fecha, fecha_factura, total")
      .eq("empresa_id", empresaId)
      .in("numero_control", numeros.slice(0, 200));
    if (q.error) throw new Error(q.error.message);
    for (const r of (q.data ?? []) as Array<Record<string, unknown>>) {
      const nc = String(r.numero_control ?? "");
      const prev = detalle.get(nc);
      if (prev) { prev.total += num(r.total); continue; }
      detalle.set(nc, {
        numero_factura: r.numero_factura == null ? null : String(r.numero_factura),
        fecha: String(r.fecha_factura ?? r.fecha ?? "").slice(0, 10) || null,
        total: num(r.total),
      });
    }
  }

  return {
    cheque,
    hay_recibo: hayRecibo,
    facturas: imputadas.map((r) => {
      const nc = String(r.compra_numero_control ?? "");
      const d = detalle.get(nc);
      return {
        numero_control: nc,
        numero_factura: d?.numero_factura ?? null,
        fecha: d?.fecha ?? null,
        total: d?.total ?? 0,
        importe_imputado: num(r.importe_imputado),
      };
    }),
  };
}
