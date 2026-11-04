import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_COMPROBANTE_MIME, COMPRAS_FACTURAS_BUCKET, MAX_COMPROBANTE_BYTES,
  buildComprobantePath, ensureComprasFacturasBucket, signComprobante,
  comprobantePathBelongsToEmpresa,
} from "@/lib/compras/comprobante-storage";

export const runtime = "nodejs";

/**
 * El recibo que entrega el proveedor al cobrar un cheque.
 *
 * POST /api/cheques/recibo — número de recibo, fecha, archivo, y el número de
 *      cheque si todavía faltaba. Marca como pagadas las facturas que cubre.
 * GET  ?path= — URL firmada del papel.
 *
 * ── POR QUÉ ESTO ES LO MÁS IMPORTANTE DEL MÓDULO DE PAGOS ──────────────────
 *   Joaquín: "hay proveedores que traspapelan los documentos, entonces te
 *   piden de vuelta el cobro de esa factura como que vos estabas deudando".
 *
 *   El número de recibo lo emite EL PROVEEDOR. Cuando vuelve a reclamar una
 *   factura, mostrarle su propio número de recibo —con el número de cheque y
 *   la fecha— termina la discusión. Por eso los tres datos se cargan juntos y
 *   con el papel escaneado al lado.
 *
 * ── CARGAR EL RECIBO ES LO QUE SALDA LAS FACTURAS ──────────────────────────
 *   No la emisión del cheque: un cheque emitido puede no haberse entregado
 *   todavía. El recibo es la constancia de que el proveedor lo recibió, así
 *   que es el momento en que las facturas pasan a `pagada`, con el número de
 *   cheque y el de recibo escritos en la referencia de pago.
 */

const faltaScript70 = (m: string) => /numero_recibo|fecha_recibo|recibo_(storage_path|nombre|mime_type|subido_at)/.test(m);
const AVISO_70 = "Falta correr el script 70: la base todavía no tiene dónde guardar el recibo del cheque.";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const form = await request.formData();
    const chequeId = String(form.get("cheque_id") ?? "").trim();
    const numeroRecibo = String(form.get("numero_recibo") ?? "").trim();
    const numeroCheque = String(form.get("numero_cheque") ?? "").trim();
    const fechaRecibo = String(form.get("fecha_recibo") ?? "").trim();
    const file = form.get("file");

    if (!chequeId) return NextResponse.json(errorResponse("Falta el cheque."), { status: 400 });
    if (!numeroRecibo) {
      return NextResponse.json(
        errorResponse("Cargá el número del recibo: es el dato con el que se le responde al proveedor que reclama."),
        { status: 400 }
      );
    }
    if (fechaRecibo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRecibo)) {
      return NextResponse.json(errorResponse("La fecha del recibo no es válida."), { status: 400 });
    }

    const chQ = await ctx.supabase
      .from("cheques")
      .select("id, numero, estado, importe, moneda, proveedor_nombre")
      .eq("empresa_id", empresaId).eq("id", chequeId).maybeSingle();
    if (chQ.error) throw new Error(chQ.error.message);
    if (!chQ.data) return NextResponse.json(errorResponse("Cheque no encontrado."), { status: 404 });
    const cheque = chQ.data as { numero: string | null; estado: string; importe: number; proveedor_nombre: string };

    if (cheque.estado === "anulado") {
      return NextResponse.json(
        errorResponse("Ese cheque está anulado: no puede tener un recibo."),
        { status: 409 }
      );
    }

    const numeroFinal = numeroCheque || cheque.numero || "";
    if (!numeroFinal) {
      return NextResponse.json(
        errorResponse("El cheque no tiene número. Cargalo acá: sin él, el recibo no prueba qué se pagó."),
        { status: 400 }
      );
    }

    // ── El archivo, si vino. Se sube ANTES de escribir la fila.
    let path: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_COMPROBANTE_BYTES) {
        return NextResponse.json(
          errorResponse(`El recibo no puede pesar más de ${Math.round(MAX_COMPROBANTE_BYTES / 1024 / 1024)} MB.`),
          { status: 400 }
        );
      }
      const mime = file.type || "application/octet-stream";
      if (!ALLOWED_COMPROBANTE_MIME.has(mime)) {
        return NextResponse.json(
          errorResponse("Formato no admitido. Subí un PDF o una foto (JPG, PNG)."),
          { status: 400 }
        );
      }
      await ensureComprasFacturasBucket(ctx.supabase);
      path = buildComprobantePath(empresaId, randomUUID(), mime, "recibos");
      const up = await ctx.supabase.storage
        .from(COMPRAS_FACTURAS_BUCKET)
        .upload(path, file, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
    }

    const ahora = new Date().toISOString();
    const patch: Record<string, unknown> = {
      numero: numeroFinal,
      numero_recibo: numeroRecibo.slice(0, 100),
      fecha_recibo: fechaRecibo || ahora.slice(0, 10),
      updated_at: ahora,
    };
    if (path && file instanceof File) {
      patch.recibo_storage_path = path;
      patch.recibo_nombre = file.name?.slice(0, 200) || "recibo";
      patch.recibo_mime_type = file.type || "application/octet-stream";
      patch.recibo_subido_at = ahora;
    }
    // Con el recibo en la mano el cheque está entregado: si seguía figurando
    // pendiente de emisión, pasa a emitido.
    if (cheque.estado === "pendiente_emision") patch.estado = "emitido";

    const upd = await ctx.supabase
      .from("cheques").update(patch)
      .eq("empresa_id", empresaId).eq("id", chequeId);
    if (upd.error) {
      if (path) await ctx.supabase.storage.from(COMPRAS_FACTURAS_BUCKET).remove([path]).catch(() => {});
      if (faltaScript70(upd.error.message)) {
        return NextResponse.json(errorResponse(AVISO_70), { status: 503 });
      }
      throw new Error(upd.error.message);
    }

    // ── Las facturas que cubre pasan a pagadas ────────────────────────────
    const ccQ = await ctx.supabase
      .from("cheque_compras")
      .select("compra_numero_control")
      .eq("empresa_id", empresaId).eq("cheque_id", chequeId).limit(500);
    if (ccQ.error) throw new Error(ccQ.error.message);
    const numeros = [...new Set(
      ((ccQ.data ?? []) as Array<{ compra_numero_control?: string }>)
        .map((r) => String(r.compra_numero_control ?? "")).filter(Boolean)
    )];

    let saldadas = 0;
    if (numeros.length > 0) {
      // La referencia junta los dos números a propósito: es exactamente lo que
      // hay que leerle al proveedor que vuelve a reclamar la factura.
      const referencia = `Cheque N° ${numeroFinal} · Recibo N° ${numeroRecibo}`;
      const updC = await ctx.supabase
        .from("compras")
        .update({
          estado: "pagada",
          metodo_pago: "cheque",
          referencia_pago: referencia.slice(0, 200),
          fecha_pago: patch.fecha_recibo,
          updated_at: ahora,
        })
        .eq("empresa_id", empresaId)
        .in("numero_control", numeros)
        .neq("estado", "anulada");
      if (updC.error) throw new Error(updC.error.message);
      saldadas = numeros.length;
    }

    return NextResponse.json(successResponse({
      ok: true,
      numero_cheque: numeroFinal,
      numero_recibo: numeroRecibo,
      facturas_saldadas: saldadas,
      url: path ? await signComprobante(ctx.supabase, path) : null,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/cheques/recibo POST]", msg);
    if (faltaScript70(msg)) return NextResponse.json(errorResponse(AVISO_70), { status: 503 });
    return NextResponse.json(errorResponse("No se pudo cargar el recibo."), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const path = (new URL(request.url).searchParams.get("path") ?? "").trim();
    if (!comprobantePathBelongsToEmpresa(path, ctx.auth.empresa_id)) {
      return NextResponse.json(errorResponse("Recibo no encontrado."), { status: 404 });
    }
    const url = await signComprobante(ctx.supabase, path);
    if (!url) return NextResponse.json(errorResponse("No se pudo abrir el recibo."), { status: 404 });
    return NextResponse.json(successResponse({ url }));
  } catch (err) {
    console.error("[/api/cheques/recibo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo abrir el recibo."), { status: 500 });
  }
}
