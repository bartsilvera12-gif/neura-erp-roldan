import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { traerTodas } from "@/lib/supabase/traer-todo";

/**
 * GET /api/pagos/realizados?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Lo que ya se le pagó a los proveedores, en un solo lugar.
 *
 * ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
 *   Las facturas a crédito en estado `pagada`, con su fecha, medio y
 *   referencia de pago. Las que se pagaron con un cheque de la orden de pago
 *   se juntan en UN pago con el cheque (número, banco, recibo del proveedor y
 *   foto), porque así se pagaron: un cheque, varias facturas, un recibo.
 *   Las demás son un pago cada una, con el recibo que se cargó en la factura.
 *
 *   El período es por fecha de pago. Las facturas marcadas pagadas sin fecha
 *   no entran en ningún período: se listan aparte si se pide `sin_fecha=1`.
 */

type Factura = {
  numero_control: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  total: number;
};

type Pago = {
  clave: string;
  fecha: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string;
  medio: string | null;
  referencia: string | null;
  total: number;
  facturas: Factura[];
  cheque: {
    id: string;
    numero: string | null;
    banco: string | null;
    numero_recibo: string | null;
    fecha_recibo: string | null;
    imagen_path: string | null;
    /* Lo que hacía falta para poder abrir un pago y VER el cheque. */
    medio: string | null;
    importe: number | null;
    estado: string | null;
    fecha_emision: string | null;
    fecha_cobro_prevista: string | null;
    fecha_cobro_real: string | null;
  } | null;
  recibo_path: string | null;
};

const esFecha = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde");
    const hasta = sp.get("hasta");
    const sinFecha = sp.get("sin_fecha") === "1";

    // ── Las facturas pagadas (una fila por línea de la compra) ────────────
    const pedir = (conRecibo: boolean) =>
      traerTodas<Record<string, unknown>>((a, b) => {
        let q = ctx.supabase
          .from("compras")
          .select(conRecibo
            ? "id, numero_control, proveedor_id, proveedor_nombre, numero_factura, fecha, fecha_factura, metodo_pago, referencia_pago, fecha_pago, total, recibo_storage_path"
            : "id, numero_control, proveedor_id, proveedor_nombre, numero_factura, fecha, fecha_factura, metodo_pago, referencia_pago, fecha_pago, total")
          .eq("empresa_id", empresaId)
          .eq("tipo_pago", "credito")
          .eq("estado", "pagada");
        if (sinFecha) q = q.is("fecha_pago", null);
        else {
          if (esFecha(desde)) q = q.gte("fecha_pago", desde!);
          if (esFecha(hasta)) q = q.lte("fecha_pago", hasta!);
        }
        return q.order("id").range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      });
    let filas: Record<string, unknown>[];
    try {
      filas = await pedir(true);
    } catch (e) {
      if (!/recibo_/.test(e instanceof Error ? e.message : "")) throw e;
      filas = await pedir(false); // sin el script 68
    }

    type FacturaFull = Factura & {
      proveedor_id: string | null; proveedor_nombre: string;
      metodo_pago: string | null; referencia_pago: string | null; fecha_pago: string | null;
      recibo_path: string | null;
    };
    const porNc = new Map<string, FacturaFull>();
    for (const r of filas) {
      const nc = String(r.numero_control ?? "");
      if (!nc) continue;
      let f = porNc.get(nc);
      if (!f) {
        f = {
          numero_control: nc,
          numero_factura: r.numero_factura ? String(r.numero_factura) : null,
          fecha_factura: String(r.fecha_factura ?? r.fecha ?? "").slice(0, 10) || null,
          total: 0,
          proveedor_id: r.proveedor_id ? String(r.proveedor_id) : null,
          proveedor_nombre: String(r.proveedor_nombre ?? "—"),
          metodo_pago: r.metodo_pago ? String(r.metodo_pago) : null,
          referencia_pago: r.referencia_pago ? String(r.referencia_pago) : null,
          fecha_pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : null,
          recibo_path: r.recibo_storage_path ? String(r.recibo_storage_path) : null,
        };
        porNc.set(nc, f);
      }
      f.total += Number(r.total) || 0;
      if (!f.recibo_path && r.recibo_storage_path) f.recibo_path = String(r.recibo_storage_path);
    }

    // ── Qué facturas se pagaron con un cheque ─────────────────────────────
    const ncs = [...porNc.keys()];
    const chequeDe = new Map<string, string>();
    for (let i = 0; i < ncs.length; i += 200) {
      const q = await ctx.supabase
        .from("cheque_compras")
        .select("cheque_id, compra_numero_control")
        .eq("empresa_id", empresaId)
        .in("compra_numero_control", ncs.slice(i, i + 200));
      if (q.error) break; // sin cheques: cada factura es su propio pago
      for (const r of (q.data ?? []) as Array<{ cheque_id: string; compra_numero_control: string }>) {
        chequeDe.set(String(r.compra_numero_control), String(r.cheque_id));
      }
    }

    const chequeIds = [...new Set(chequeDe.values())];
    const cheques = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < chequeIds.length; i += 200) {
      const ids = chequeIds.slice(i, i + 200);
      let q = await ctx.supabase
        .from("cheques")
        .select("id, numero, banco_nombre, estado, medio, importe, fecha_emision, fecha_cobro_prevista, fecha_cobro_real, numero_recibo, fecha_recibo, recibo_storage_path, imagen_storage_path")
        .eq("empresa_id", empresaId).in("id", ids);
      if (q.error) {
        // Sin el script 75 (foto) o el 70 (recibo): lo que haya.
        q = await ctx.supabase
          .from("cheques").select("id, numero, banco_nombre, estado")
          .eq("empresa_id", empresaId).in("id", ids) as typeof q;
      }
      for (const c of (q.data ?? []) as Array<Record<string, unknown>>) {
        if (String(c.estado ?? "") !== "anulado") cheques.set(String(c.id), c);
      }
    }

    // ── Armar los pagos ───────────────────────────────────────────────────
    const pagos = new Map<string, Pago>();
    for (const f of porNc.values()) {
      const chId = chequeDe.get(f.numero_control);
      const ch = chId ? cheques.get(chId) : undefined;
      const clave = ch ? `cheque:${chId}` : `factura:${f.numero_control}`;
      let p = pagos.get(clave);
      if (!p) {
        p = {
          clave,
          fecha: (ch?.fecha_recibo ? String(ch.fecha_recibo).slice(0, 10) : null) ?? f.fecha_pago,
          proveedor_id: f.proveedor_id,
          proveedor_nombre: f.proveedor_nombre,
          medio: ch ? "cheque" : f.metodo_pago,
          referencia: f.referencia_pago,
          total: 0,
          facturas: [],
          cheque: ch ? {
            id: String(ch.id),
            numero: ch.numero ? String(ch.numero) : null,
            banco: ch.banco_nombre ? String(ch.banco_nombre) : null,
            numero_recibo: ch.numero_recibo ? String(ch.numero_recibo) : null,
            fecha_recibo: ch.fecha_recibo ? String(ch.fecha_recibo).slice(0, 10) : null,
            imagen_path: ch.imagen_storage_path ? String(ch.imagen_storage_path) : null,
            medio: ch.medio ? String(ch.medio) : null,
            importe: ch.importe == null ? null : Number(ch.importe),
            estado: ch.estado ? String(ch.estado) : null,
            fecha_emision: ch.fecha_emision ? String(ch.fecha_emision).slice(0, 10) : null,
            fecha_cobro_prevista: ch.fecha_cobro_prevista ? String(ch.fecha_cobro_prevista).slice(0, 10) : null,
            fecha_cobro_real: ch.fecha_cobro_real ? String(ch.fecha_cobro_real).slice(0, 10) : null,
          } : null,
          recibo_path: ch?.recibo_storage_path ? String(ch.recibo_storage_path) : f.recibo_path,
        };
        pagos.set(clave, p);
      }
      p.total += f.total;
      p.facturas.push({
        numero_control: f.numero_control,
        numero_factura: f.numero_factura,
        fecha_factura: f.fecha_factura,
        total: f.total,
      });
      if (!p.recibo_path && f.recibo_path) p.recibo_path = f.recibo_path;
    }

    const lista = [...pagos.values()].sort((a, b) =>
      (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.proveedor_nombre.localeCompare(b.proveedor_nombre, "es"));
    for (const p of lista) {
      p.total = Math.round(p.total);
      p.facturas.sort((a, b) => (a.fecha_factura ?? "").localeCompare(b.fecha_factura ?? ""));
    }

    return NextResponse.json(successResponse({ pagos: lista }));
  } catch (err) {
    console.error("[/api/pagos/realizados GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los pagos realizados."), { status: 500 });
  }
}
