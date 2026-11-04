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
 * El recibo del PAGO al proveedor (no la factura que trajo la mercadería).
 *
 * POST   /api/compras/recibo        — sube el archivo y lo ata a la compra.
 * GET    /api/compras/recibo?path=  — URL firmada para verlo.
 * DELETE /api/compras/recibo?numero_control= — lo desvincula.
 *
 * POR QUÉ ES OTRO DOCUMENTO Y NO EL MISMO CAMPO
 *   `comprobante_storage_path` es la factura del proveedor, el papel que llega
 *   con la mercadería. El recibo es el que el proveedor firma cuando COBRA, y
 *   es el que alguien busca cuando pregunta si una factura se pagó de verdad.
 *   Compartir campo haría que subir uno borre el otro.
 *
 * POR QUÉ CUELGA DE LA COMPRA Y NO DEL EGRESO DE CAJA
 *   Un pago puede registrarse sin turno de caja abierto: la compra queda
 *   pagada y no hay movimiento al que colgarle el papel. La compra siempre
 *   está.
 *
 * EL ARCHIVO SE SUBE ANTES DE ESCRIBIR LA FILA
 *   Si falla la escritura queda un archivo huérfano, que es barato. Al revés
 *   —una compra diciendo que tiene recibo cuando la subida falló— es una
 *   mentira que solo se descubre al abrirlo.
 */

/** La compra existe y es de esta empresa. Devuelve si ya está pagada. */
async function compraDe(
  ctx: NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>,
  numeroControl: string
): Promise<{ existe: boolean; pagada: boolean }> {
  const q = await ctx.supabase
    .from("compras")
    .select("numero_control, estado")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("numero_control", numeroControl)
    .limit(50);
  if (q.error) throw new Error(q.error.message);
  const filas = (q.data ?? []) as Array<{ estado?: string }>;
  return {
    existe: filas.length > 0,
    pagada: filas.some((f) => String(f.estado) === "pagada"),
  };
}

/** `true` si el error es por las columnas que agrega el script 68. */
const faltaScript68 = (msg: string) => /recibo_(storage_path|nombre|mime_type|subido_at)/.test(msg);

const AVISO_68 =
  "Falta correr el script 68 en la base: todavía no existen las columnas del recibo.";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    const numeroControl = String(form.get("numero_control") ?? "").trim();

    if (!numeroControl) {
      return NextResponse.json(errorResponse("Falta la compra."), { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo del recibo."), { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json(errorResponse("El archivo está vacío."), { status: 400 });
    }
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

    const compra = await compraDe(ctx, numeroControl);
    if (!compra.existe) {
      return NextResponse.json(errorResponse("No existe esa compra."), { status: 404 });
    }

    await ensureComprasFacturasBucket(ctx.supabase);
    const path = buildComprobantePath(ctx.auth.empresa_id, randomUUID(), mime, "recibos");

    const subida = await ctx.supabase.storage
      .from(COMPRAS_FACTURAS_BUCKET)
      .upload(path, file, { contentType: mime, upsert: false });
    if (subida.error) throw new Error(subida.error.message);

    // Una compra son varias filas con el mismo numero_control: el recibo es
    // uno solo y se escribe en todas, para que cualquiera de ellas lo tenga.
    const upd = await ctx.supabase
      .from("compras")
      .update({
        recibo_storage_path: path,
        recibo_nombre: file.name?.slice(0, 200) || "recibo",
        recibo_mime_type: mime,
        recibo_subido_at: new Date().toISOString(),
      })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("numero_control", numeroControl);

    if (upd.error) {
      // Se borra el archivo recién subido: dejarlo sería acumular basura que
      // nadie va a poder encontrar después.
      await ctx.supabase.storage.from(COMPRAS_FACTURAS_BUCKET).remove([path]).catch(() => {});
      if (faltaScript68(upd.error.message)) {
        return NextResponse.json(errorResponse(AVISO_68), { status: 503 });
      }
      throw new Error(upd.error.message);
    }

    return NextResponse.json(successResponse({
      storage_path: path,
      nombre: file.name ?? "recibo",
      mime_type: mime,
      url: await signComprobante(ctx.supabase, path),
      /** Para poder avisar que el recibo quedó cargado sobre una compra sin pagar. */
      compra_pagada: compra.pagada,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/compras/recibo POST]", msg);
    if (faltaScript68(msg)) {
      return NextResponse.json(errorResponse(AVISO_68), { status: 503 });
    }
    return NextResponse.json(errorResponse("No se pudo cargar el recibo."), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const path = (new URL(request.url).searchParams.get("path") ?? "").trim();

    // El primer segmento del path es la empresa: sin esto, con la dirección de
    // un archivo se podría ver el recibo de otro cliente.
    if (!comprobantePathBelongsToEmpresa(path, ctx.auth.empresa_id)) {
      return NextResponse.json(errorResponse("Recibo no encontrado."), { status: 404 });
    }
    const url = await signComprobante(ctx.supabase, path);
    if (!url) return NextResponse.json(errorResponse("No se pudo abrir el recibo."), { status: 404 });
    return NextResponse.json(successResponse({ url }));
  } catch (err) {
    console.error("[/api/compras/recibo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo abrir el recibo."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const numeroControl = (new URL(request.url).searchParams.get("numero_control") ?? "").trim();
    if (!numeroControl) {
      return NextResponse.json(errorResponse("Falta la compra."), { status: 400 });
    }

    const prev = await ctx.supabase
      .from("compras")
      .select("recibo_storage_path")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("numero_control", numeroControl)
      .limit(1);
    if (prev.error) {
      if (faltaScript68(prev.error.message)) {
        return NextResponse.json(errorResponse(AVISO_68), { status: 503 });
      }
      throw new Error(prev.error.message);
    }
    const path = ((prev.data ?? [])[0] as { recibo_storage_path?: string } | undefined)?.recibo_storage_path;

    const upd = await ctx.supabase
      .from("compras")
      .update({
        recibo_storage_path: null, recibo_nombre: null,
        recibo_mime_type: null, recibo_subido_at: null,
      })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("numero_control", numeroControl);
    if (upd.error) throw new Error(upd.error.message);

    // El archivo se borra DESPUÉS de soltar la referencia: si esto falla, lo
    // que queda es un archivo huérfano, no una compra apuntando a la nada.
    if (path && comprobantePathBelongsToEmpresa(path, ctx.auth.empresa_id)) {
      await ctx.supabase.storage.from(COMPRAS_FACTURAS_BUCKET).remove([path]).catch(() => {});
    }

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/compras/recibo DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar el recibo."), { status: 500 });
  }
}
