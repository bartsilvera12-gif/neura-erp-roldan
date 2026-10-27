import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_COMPROBANTE_MIME,
  COMPRAS_FACTURAS_BUCKET,
  MAX_COMPROBANTE_BYTES,
  buildComprobantePath,
  ensureComprasFacturasBucket,
  signComprobante,
  comprobantePathBelongsToEmpresa,
} from "@/lib/compras/comprobante-storage";

export const runtime = "nodejs";

/**
 * Factura y recibo que respaldan un egreso de caja (punto 5.7).
 *
 * POST → sube el archivo y devuelve la referencia para guardarla en el
 *        movimiento. Se sube ANTES de registrar el egreso: si el egreso
 *        falla, queda un archivo huérfano —barato— y no al revés, un egreso
 *        diciendo que tiene comprobante cuando no se subió.
 * GET ?path= → URL firmada para verlo. El bucket es privado: sin firmar, el
 *        archivo no se abre ni sabiendo la dirección.
 *
 * Usa el mismo bucket que las facturas de compra, en la carpeta "caja". Es el
 * mismo tipo de papel y los mismos límites; un bucket aparte solo agregaría
 * configuración que mantener.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo."), { status: 400 });
    }
    if (!ALLOWED_COMPROBANTE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Sacale una foto (JPG o PNG) o subí el PDF."),
        { status: 400 }
      );
    }
    if (file.size > MAX_COMPROBANTE_BYTES) {
      const mb = (MAX_COMPROBANTE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        errorResponse(`El archivo pesa más de ${mb} MB. Si es una foto, sacala con menos resolución.`),
        { status: 413 }
      );
    }

    try {
      await ensureComprasFacturasBucket(supabase);
    } catch (e) {
      // Si el bucket ya existe y el ensure falla por permisos, el upload anda igual.
      console.error("[caja/comprobante/upload] ensureBucket", e instanceof Error ? e.message : e);
    }

    const path = buildComprobantePath(auth.empresa_id, randomUUID(), file.type, "caja");
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(COMPRAS_FACTURAS_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (up.error) {
      console.error("[caja/comprobante/upload]", up.error.message);
      return NextResponse.json(errorResponse("No se pudo subir el archivo."), { status: 500 });
    }

    return NextResponse.json(successResponse({
      path,
      nombre: (file.name || "comprobante").slice(0, 200),
      mime: file.type,
    }));
  } catch (err) {
    console.error("[caja/comprobante/upload]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir el archivo."), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const path = new URL(request.url).searchParams.get("path") ?? "";
    // Se compara contra la empresa del que pide, no contra la del path: si no,
    // cualquiera que adivine una dirección se baja el comprobante de otro.
    if (!comprobantePathBelongsToEmpresa(path, ctx.auth.empresa_id)) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }
    const url = await signComprobante(ctx.supabase, path);
    if (!url) return NextResponse.json(errorResponse("No se pudo abrir el archivo."), { status: 404 });
    return NextResponse.json(successResponse({ url }));
  } catch (err) {
    console.error("[caja/comprobante GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo abrir el archivo."), { status: 500 });
  }
}
