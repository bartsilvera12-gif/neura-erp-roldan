import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";

export const dynamic = "force-dynamic";

/**
 * GET /api/pagos/proveedores-estado-cuenta
 *
 * Estado de cuenta con proveedores: agrupa las COMPRAS A CRÉDITO (una factura =
 * un numero_control) por proveedor y clasifica cada factura en pendiente /
 * vencida / pagada, con su fecha de vencimiento (fecha_factura + plazo_dias).
 */

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type FacturaRow = {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  numero_factura: string | null;
  fecha: string | null;
  fecha_factura: string | null;
  plazo_dias: number | null;
  estado: string;
  metodo_pago: string | null;
  referencia_pago: string | null;
  fecha_pago: string | null;
  total: number;
  vencimiento: string | null;
  vencida: boolean;
  dias_para_vencer: number | null;
  /** Recibo del pago. Null mientras no se haya cargado, o si falta el script 68. */
  recibo_storage_path: string | null;
  recibo_nombre: string | null;
  recibo_subido_at: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(req);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    // Todas las filas, no las primeras mil: hay ~14.600 compras a crédito y
    // sin paginar el total pendiente salía con una fracción de ellas.
    // `estado` NULL cuenta como vigente (igual que COALESCE(estado,'registrada')
    // en el Estado de cuenta): `.neq` a secas descarta los NULL.
    // Las columnas del recibo las agrega el script 68. Mientras no se haya
    // corrido, PostgREST rechaza la consulta ENTERA con 42703 —no devuelve la
    // fila sin la columna— y la pantalla quedaría vacía. Por eso se reintenta
    // sin ellas: es preferible un estado de cuenta sin recibos que ninguno.
    // El `select` de supabase-js se tipa desde el LITERAL, así que no puede
    // salir de una variable ni de un ternario: van dos consultas escritas
    // enteras, una con las columnas del recibo y otra sin ellas.
    let hayRecibos = true;
    let rows: Record<string, unknown>[];
    try {
      rows = await traerTodas<Record<string, unknown>>((desde, hasta) =>
        ctx.supabase
          .from("compras")
          .select("numero_control, proveedor_id, proveedor_nombre, numero_factura, fecha, fecha_factura, plazo_dias, tipo_pago, estado, metodo_pago, referencia_pago, fecha_pago, total, recibo_storage_path, recibo_nombre, recibo_subido_at")
          .eq("empresa_id", ctx.auth.empresa_id)
          .eq("tipo_pago", "credito")
          .or("estado.is.null,estado.neq.anulada")
          .order("id")
          .range(desde, hasta)
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/recibo_/.test(msg)) throw e;
      hayRecibos = false;
      rows = await traerTodas<Record<string, unknown>>((desde, hasta) =>
        ctx.supabase
          .from("compras")
          .select("numero_control, proveedor_id, proveedor_nombre, numero_factura, fecha, fecha_factura, plazo_dias, tipo_pago, estado, metodo_pago, referencia_pago, fecha_pago, total")
          .eq("empresa_id", ctx.auth.empresa_id)
          .eq("tipo_pago", "credito")
          .or("estado.is.null,estado.neq.anulada")
          .order("id")
          .range(desde, hasta)
      );
    }
    // Hoy en Paraguay (UTC−3): con la fecha UTC, desde las 21:00 una factura
    // que vence mañana ya figuraba vencida.
    const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Agrupar por numero_control (una factura tiene varias líneas).
    const facturas = new Map<string, FacturaRow>();
    for (const r of rows) {
      const nc = String(r.numero_control ?? "");
      if (!nc) continue;
      let f = facturas.get(nc);
      if (!f) {
        const fechaFactura = r.fecha_factura ? String(r.fecha_factura).slice(0, 10) : null;
        const fechaBase = fechaFactura ?? (r.fecha ? String(r.fecha).slice(0, 10) : null);
        const plazo = r.plazo_dias != null ? Number(r.plazo_dias) : null;
        const venc = fechaBase && plazo != null ? addDaysISO(fechaBase, plazo) : null;
        f = {
          numero_control: nc,
          proveedor_id: r.proveedor_id ? String(r.proveedor_id) : null,
          proveedor_nombre: String(r.proveedor_nombre ?? "—"),
          numero_factura: r.numero_factura ? String(r.numero_factura) : null,
          fecha: r.fecha ? String(r.fecha).slice(0, 10) : null,
          fecha_factura: fechaFactura,
          plazo_dias: plazo,
          estado: String(r.estado ?? "registrada"),
          metodo_pago: r.metodo_pago ? String(r.metodo_pago) : null,
          referencia_pago: r.referencia_pago ? String(r.referencia_pago) : null,
          fecha_pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : null,
          total: 0,
          vencimiento: venc,
          vencida: false,
          dias_para_vencer: null,
          recibo_storage_path: r.recibo_storage_path ? String(r.recibo_storage_path) : null,
          recibo_nombre: r.recibo_nombre ? String(r.recibo_nombre) : null,
          recibo_subido_at: r.recibo_subido_at ? String(r.recibo_subido_at) : null,
        };
        facturas.set(nc, f);
      }
      f.total += Number(r.total) || 0;
    }

    // Notas de crédito de compra: reducen lo que se debe por numero_control.
    // Mismo criterio que /api/pagos/por-pagar para que todo quede correlativo.
    const ncPorCompra = new Map<string, number>();
    try {
      const ncQ = await ctx.supabase
        .from("notas_credito_compra")
        .select("compra_numero_control, monto")
        .eq("empresa_id", ctx.auth.empresa_id);
      for (const r of (ncQ.data ?? []) as Array<{ compra_numero_control: string | null; monto: number | string }>) {
        const k = r.compra_numero_control ?? "";
        if (!k) continue;
        ncPorCompra.set(k, (ncPorCompra.get(k) ?? 0) + (Number(r.monto) || 0));
      }
    } catch {
      /* tabla notas_credito_compra inexistente todavía */
    }
    for (const f of facturas.values()) {
      const nc = ncPorCompra.get(f.numero_control) ?? 0;
      if (nc > 0) f.total = Math.max(0, f.total - nc);
    }

    // Clasificar vencimiento por factura.
    for (const f of facturas.values()) {
      const pagada = f.estado === "pagada";
      if (f.vencimiento) {
        const diffMs = new Date(`${f.vencimiento}T00:00:00`).getTime() - new Date(`${hoy}T00:00:00`).getTime();
        f.dias_para_vencer = Math.round(diffMs / 86400000);
        f.vencida = !pagada && f.vencimiento < hoy;
      }
    }

    // Agrupar por proveedor.
    type Prov = {
      proveedor_id: string | null;
      proveedor_nombre: string;
      total_pendiente: number;
      total_vencido: number;
      total_pagado: number;
      cant_pendiente: number;
      cant_vencida: number;
      cant_pagada: number;
      proximo_vencimiento: string | null;
      facturas: FacturaRow[];
    };
    const provs = new Map<string, Prov>();
    for (const f of facturas.values()) {
      const key = f.proveedor_id ?? f.proveedor_nombre;
      let p = provs.get(key);
      if (!p) {
        p = {
          proveedor_id: f.proveedor_id,
          proveedor_nombre: f.proveedor_nombre,
          total_pendiente: 0,
          total_vencido: 0,
          total_pagado: 0,
          cant_pendiente: 0,
          cant_vencida: 0,
          cant_pagada: 0,
          proximo_vencimiento: null,
          facturas: [],
        };
        provs.set(key, p);
      }
      p.facturas.push(f);
      if (f.estado === "pagada") {
        p.total_pagado += f.total;
        p.cant_pagada += 1;
      } else {
        p.total_pendiente += f.total;
        p.cant_pendiente += 1;
        if (f.vencida) {
          p.total_vencido += f.total;
          p.cant_vencida += 1;
        }
        if (f.vencimiento && (!p.proximo_vencimiento || f.vencimiento < p.proximo_vencimiento)) {
          p.proximo_vencimiento = f.vencimiento;
        }
      }
    }

    const proveedores = [...provs.values()]
      .map((p) => ({
        ...p,
        facturas: p.facturas.sort((a, b) => (a.vencimiento ?? "9999").localeCompare(b.vencimiento ?? "9999")),
      }))
      .sort((a, b) => b.total_pendiente - a.total_pendiente);

    const totales = proveedores.reduce(
      (acc, p) => ({
        pendiente: acc.pendiente + p.total_pendiente,
        vencido: acc.vencido + p.total_vencido,
        pagado: acc.pagado + p.total_pagado,
      }),
      { pendiente: 0, vencido: 0, pagado: 0 }
    );

    // `recibos_disponibles` deja que la pantalla distinga "no hay recibo
    // cargado" de "la base todavía no tiene dónde guardarlo".
    return NextResponse.json(successResponse({ proveedores, totales, recibos_disponibles: hayRecibos }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
