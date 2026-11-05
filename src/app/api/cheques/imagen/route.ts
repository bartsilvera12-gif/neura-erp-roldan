import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_COMPROBANTE_MIME, COMPRAS_FACTURAS_BUCKET, MAX_COMPROBANTE_BYTES,
  buildComprobantePath, ensureComprasFacturasBucket, signComprobante,
} from "@/lib/compras/comprobante-storage";

export const runtime = "nodejs";

/**
 * La foto del cheque emitido (script 75).
 *
 * POST /api/cheques/imagen — form: cheque_id + file. Si ya tenía una, la
 *      reemplaza y borra la anterior.
 *
 * Para verla se usa GET /api/cheques/recibo?path=…, que ya firma cualquier
 * archivo de la empresa en ese bucket.
 *
 * No es el recibo del proveedor: el cheque lo hace la empresa al armar el
 * pago; el recibo llega después, cuando el proveedor lo retira.
 */

const faltaScript75 = (m: string) => /imagen_(storage_path|nombre|mime_type|subido_at)/.test(m);
const AVISO_75 = "Falta correr el script 75: la base todavía no tiene dónde guardar la foto del cheque.";

export async function POST(request: NextRequest) {
  let path: string | null = null;
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const form = await request.formData();
    const chequeId = String(form.get("cheque_id") ?? "").trim();
    const file = form.get("file");
    if (!chequeId) return NextResponse.json(errorResponse("Falta el cheque."), { status: 400 });
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(errorResponse("Elegí la foto o el PDF del cheque."), { status: 400 });
    }
    if (file.size > MAX_COMPROBANTE_BYTES) {
      return NextResponse.json(
        errorResponse(`El archivo no puede pesar más de ${Math.round(MAX_COMPROBANTE_BYTES / 1024 / 1024)} MB.`),
        { status: 400 }
      );
    }
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_COMPROBANTE_MIME.has(mime)) {
      return NextResponse.json(errorResponse("Formato no admitido. Subí una foto (JPG, PNG) o un PDF."), { status: 400 });
    }

    const chQ = await ctx.supabase
      .from("cheques").select("id, estado, imagen_storage_path")
      .eq("empresa_id", empresaId).eq("id", chequeId).maybeSingle();
    if (chQ.error) {
      if (faltaScript75(chQ.error.message)) return NextResponse.json(errorResponse(AVISO_75), { status: 503 });
      throw new Error(chQ.error.message);
    }
    if (!chQ.data) return NextResponse.json(errorResponse("Cheque no encontrado."), { status: 404 });
    const anterior = (chQ.data as { imagen_storage_path?: string | null }).imagen_storage_path ?? null;

    await ensureComprasFacturasBucket(ctx.supabase);
    path = buildComprobantePath(empresaId, randomUUID(), mime, "cheques");
    const up = await ctx.supabase.storage
      .from(COMPRAS_FACTURAS_BUCKET)
      .upload(path, file, { contentType: mime, upsert: false });
    if (up.error) throw new Error(up.error.message);

    const ahora = new Date().toISOString();
    const upd = await ctx.supabase
      .from("cheques")
      .update({
        imagen_storage_path: path,
        imagen_nombre: file.name?.slice(0, 200) || "cheque",
        imagen_mime_type: mime,
        imagen_subido_at: ahora,
        updated_at: ahora,
      })
      .eq("empresa_id", empresaId).eq("id", chequeId);
    if (upd.error) {
      await ctx.supabase.storage.from(COMPRAS_FACTURAS_BUCKET).remove([path]).catch(() => {});
      if (faltaScript75(upd.error.message)) return NextResponse.json(errorResponse(AVISO_75), { status: 503 });
      throw new Error(upd.error.message);
    }
    if (anterior && anterior !== path) {
      await ctx.supabase.storage.from(COMPRAS_FACTURAS_BUCKET).remove([anterior]).catch(() => {});
    }

    return NextResponse.json(successResponse({
      imagen_storage_path: path,
      url: await signComprobante(ctx.supabase, path),
    }));
  } catch (err) {
    console.error("[/api/cheques/imagen POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir la foto del cheque."), { status: 500 });
  }
}
