import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Cheques a proveedores.
 *
 * GET  /api/cheques?desde&hasta&estado&proveedor_id — listado.
 * POST /api/cheques — crea un cheque y lo imputa a facturas del proveedor.
 *
 * Reglas (definidas con el cliente):
 *  · Un cheque es de UN solo proveedor; puede cubrir varias facturas suyas.
 *  · Nace `pendiente_emision` (sin número) y se emite después, en la jornada
 *    en que se sientan a hacer todos los cheques juntos.
 */

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown, max = 200): string | null =>
  v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max);
const esFecha = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;

    let q = ctx.supabase
      .from("cheques")
      .select("id, proveedor_id, proveedor_nombre, numero, entidad_bancaria_id, banco_nombre, moneda, importe, estado, fecha_pago_prevista, fecha_emision, fecha_cobro_prevista, fecha_cobro_real, observacion")
      .eq("empresa_id", ctx.auth.empresa_id);

    const desde = esFecha(sp.get("desde"));
    const hasta = esFecha(sp.get("hasta"));
    if (desde) q = q.gte("fecha_pago_prevista", desde);
    if (hasta) q = q.lte("fecha_pago_prevista", hasta);
    const estado = sp.get("estado");
    if (estado) q = q.eq("estado", estado);
    const prov = sp.get("proveedor_id");
    if (prov) q = q.eq("proveedor_id", prov);

    const { data, error } = await q.order("fecha_pago_prevista", { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ cheques: data ?? [] }));
  } catch (err) {
    console.error("[/api/cheques GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los cheques."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const o = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    const proveedorId = str(o.proveedor_id, 64);
    if (!proveedorId) {
      return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    }
    const fechaPago = esFecha(o.fecha_pago_prevista);
    if (!fechaPago) {
      return NextResponse.json(errorResponse("Falta la fecha de pago (YYYY-MM-DD)."), { status: 400 });
    }
    const moneda = String(o.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG";

    // Facturas que cubre. Tienen que ser todas del mismo proveedor: el cliente
    // no mezcla proveedores en un cheque.
    const crudas = Array.isArray(o.facturas) ? (o.facturas as Record<string, unknown>[]) : [];
    const facturas = crudas
      .map((f) => ({ numero_control: str(f.numero_control, 64), importe: num(f.importe_imputado) }))
      .filter((f): f is { numero_control: string; importe: number } => !!f.numero_control);

    if (facturas.length > 0) {
      const { data: comprasData, error: comprasErr } = await ctx.supabase
        .from("compras")
        .select("numero_control, proveedor_id")
        .eq("empresa_id", empresaId)
        .in("numero_control", facturas.map((f) => f.numero_control));
      if (comprasErr) throw new Error(comprasErr.message);
      const rows = (comprasData ?? []) as Array<Record<string, unknown>>;
      const encontradas = new Set(rows.map((r) => String(r.numero_control)));
      const ajenas = rows.filter((r) => String(r.proveedor_id ?? "") !== proveedorId);

      const faltan = facturas.filter((f) => !encontradas.has(f.numero_control));
      if (faltan.length > 0) {
        return NextResponse.json(
          errorResponse(`No existen estas facturas: ${faltan.map((f) => f.numero_control).join(", ")}.`),
          { status: 400 }
        );
      }
      if (ajenas.length > 0) {
        return NextResponse.json(
          errorResponse("Un cheque solo puede cubrir facturas de un mismo proveedor."),
          { status: 400 }
        );
      }
      // Una factura ya cubierta por otro cheque no se puede volver a imputar.
      const { data: yaCubiertas, error: ycErr } = await ctx.supabase
        .from("cheque_compras")
        .select("compra_numero_control")
        .eq("empresa_id", empresaId)
        .in("compra_numero_control", facturas.map((f) => f.numero_control));
      if (ycErr) throw new Error(ycErr.message);
      const dup = (yaCubiertas ?? []) as Array<Record<string, unknown>>;
      if (dup.length > 0) {
        return NextResponse.json(
          errorResponse(`Ya tienen cheque: ${dup.map((d) => String(d.compra_numero_control)).join(", ")}.`),
          { status: 409 }
        );
      }
    }

    // Si no se declara importe, se toma la suma de lo imputado.
    const importe = num(o.importe) || facturas.reduce((a, f) => a + f.importe, 0);
    if (importe <= 0) {
      return NextResponse.json(errorResponse("El importe del cheque tiene que ser mayor a cero."), { status: 400 });
    }

    const ins = await ctx.supabase
      .from("cheques")
      .insert({
        empresa_id: empresaId,
        proveedor_id: proveedorId,
        proveedor_nombre: str(o.proveedor_nombre),
        numero: str(o.numero, 64),
        entidad_bancaria_id: str(o.entidad_bancaria_id, 64),
        banco_nombre: str(o.banco_nombre),
        moneda,
        importe,
        estado: str(o.numero, 64) ? "emitido" : "pendiente_emision",
        fecha_pago_prevista: fechaPago,
        fecha_emision: str(o.numero, 64) ? (esFecha(o.fecha_emision) ?? fechaPago) : null,
        fecha_cobro_prevista: esFecha(o.fecha_cobro_prevista),
        observacion: str(o.observacion, 1000),
        created_by: ctx.auth.usuarioCatalogId ?? null,
      })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    const chequeId = String((ins.data as { id: string }).id);

    if (facturas.length > 0) {
      const { error: ccErr } = await ctx.supabase.from("cheque_compras").insert(
        facturas.map((f) => ({
          empresa_id: empresaId,
          cheque_id: chequeId,
          compra_numero_control: f.numero_control,
          importe_imputado: f.importe,
        }))
      );
      if (ccErr) {
        // Sin las facturas el cheque no sirve: se deshace para no dejarlo colgado.
        await ctx.supabase.from("cheques").delete().eq("id", chequeId).eq("empresa_id", empresaId);
        throw new Error(ccErr.message);
      }
    }

    return NextResponse.json(successResponse({ cheque_id: chequeId }), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo crear el cheque.";
    console.error("[/api/cheques POST]", msg);
    const status = /duplicate|unique/i.test(msg) ? 409 : 500;
    return NextResponse.json(
      errorResponse(/duplicate|unique/i.test(msg) ? "Ya existe un cheque con ese número en ese banco." : msg),
      { status }
    );
  }
}
