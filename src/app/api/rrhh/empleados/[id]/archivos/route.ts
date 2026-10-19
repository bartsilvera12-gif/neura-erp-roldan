import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  ALLOWED_ARCHIVO_MIME,
  MAX_ARCHIVO_BYTES,
  EMPLEADO_ARCHIVOS_BUCKET,
  buildEmpleadoArchivoPath,
  ensureEmpleadoArchivosBucket,
  pathBelongsToEmpresa,
  signEmpleadoArchivo,
} from "@/lib/rrhh/empleado-archivos-storage";

/**
 * Archivos / documentación adjunta a un empleado.
 *
 *  GET    /api/rrhh/empleados/[id]/archivos             → lista + URLs firmadas.
 *  POST   /api/rrhh/empleados/[id]/archivos             → multipart con "file"+.
 *  DELETE /api/rrhh/empleados/[id]/archivos?archivoId=  → quita storage + fila.
 */

async function ownsEmpleado(
  sb: AppSupabaseClient,
  empresaId: string,
  empleadoId: string
): Promise<boolean> {
  const { data, error } = await sb
    .from("empleados")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", empleadoId)
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: empleadoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    if (!(await ownsEmpleado(ctx.supabase, empresaId, empleadoId))) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from("empleado_archivos")
      .select("id, nombre, mime_type, size_bytes, storage_path, storage_bucket, created_at")
      .eq("empresa_id", empresaId)
      .eq("empleado_id", empleadoId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as Array<{
      id: string;
      nombre: string;
      mime_type: string | null;
      size_bytes: number | null;
      storage_path: string;
      storage_bucket: string;
      created_at: string;
    }>;

    const archivos = await Promise.all(rows.map(async (r) => ({
      id: r.id,
      nombre: r.nombre,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      url: await signEmpleadoArchivo(ctx.supabase, r.storage_path, 3600),
    })));

    return NextResponse.json(successResponse({ archivos }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/[id]/archivos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron listar los archivos."), { status: 500 });
  }
}

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: empleadoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    if (!(await ownsEmpleado(supabase, empresaId, empleadoId))) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }

    const form = await request.formData();
    const filesRaw = form.getAll("file");
    const files = filesRaw.filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }

    try {
      await ensureEmpleadoArchivosBucket(supabase);
    } catch (bucketErr) {
      console.error("[empleado archivos POST] ensureBucket", bucketErr instanceof Error ? bucketErr.message : bucketErr);
    }

    const errores: string[] = [];
    const creados: Array<Record<string, unknown>> = [];

    for (const file of files) {
      if (!ALLOWED_ARCHIVO_MIME.has(file.type)) {
        errores.push(`"${file.name}": formato no permitido (${file.type || "desconocido"}).`);
        continue;
      }
      if (file.size > MAX_ARCHIVO_BYTES) {
        const mb = (MAX_ARCHIVO_BYTES / 1024 / 1024).toFixed(0);
        errores.push(`"${file.name}": archivo demasiado grande (máx. ${mb} MB).`);
        continue;
      }

      const insRow = await supabase
        .from("empleado_archivos")
        .insert({
          empresa_id: empresaId,
          empleado_id: empleadoId,
          nombre: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          storage_bucket: EMPLEADO_ARCHIVOS_BUCKET,
          storage_path: "pending",
          uploaded_by: auth.usuarioCatalogId ?? null,
        })
        .select("id")
        .single();
      if (insRow.error || !insRow.data) {
        errores.push(`"${file.name}": no se pudo registrar (${insRow.error?.message ?? "error desconocido"}).`);
        continue;
      }
      const archivoId = (insRow.data as { id: string }).id;

      const path = buildEmpleadoArchivoPath({
        empresaId,
        empleadoId,
        archivoId,
        mime: file.type,
      });
      const buf = Buffer.from(await file.arrayBuffer());

      const up = await supabase.storage
        .from(EMPLEADO_ARCHIVOS_BUCKET)
        .upload(path, buf, { contentType: file.type, upsert: false });
      if (up.error) {
        await supabase.from("empleado_archivos").delete().eq("id", archivoId).eq("empresa_id", empresaId);
        errores.push(`"${file.name}": fallo al subir (${up.error.message}).`);
        continue;
      }

      const updPath = await supabase
        .from("empleado_archivos")
        .update({ storage_path: path })
        .eq("id", archivoId)
        .eq("empresa_id", empresaId)
        .select("id, nombre, mime_type, size_bytes, created_at")
        .maybeSingle();
      if (updPath.error || !updPath.data) {
        await supabase.storage.from(EMPLEADO_ARCHIVOS_BUCKET).remove([path]);
        await supabase.from("empleado_archivos").delete().eq("id", archivoId).eq("empresa_id", empresaId);
        errores.push(`"${file.name}": no se pudo guardar la ruta (${updPath.error?.message ?? "error desconocido"}).`);
        continue;
      }

      const signed = await signEmpleadoArchivo(supabase, path, 3600);
      creados.push({ ...(updPath.data as Record<string, unknown>), url: signed });
    }

    return NextResponse.json(successResponse({ creados, errores }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/[id]/archivos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron subir los archivos."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: empleadoId } = await ctxParams.params;
    const archivoId = request.nextUrl.searchParams.get("archivoId");
    if (!archivoId) return NextResponse.json(errorResponse("archivoId obligatorio"), { status: 400 });

    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const sel = await supabase
      .from("empleado_archivos")
      .select("id, storage_path, storage_bucket")
      .eq("id", archivoId)
      .eq("empresa_id", empresaId)
      .eq("empleado_id", empleadoId)
      .maybeSingle();
    if (sel.error) return NextResponse.json(errorResponse(sel.error.message), { status: 400 });
    if (!sel.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const row = sel.data as { id: string; storage_path: string; storage_bucket: string };
    if (row.storage_path && pathBelongsToEmpresa(row.storage_path, empresaId)) {
      await supabase.storage
        .from(row.storage_bucket || EMPLEADO_ARCHIVOS_BUCKET)
        .remove([row.storage_path]);
    }
    const del = await supabase
      .from("empleado_archivos")
      .delete()
      .eq("id", archivoId)
      .eq("empresa_id", empresaId);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 400 });
    return NextResponse.json(successResponse({ id: archivoId }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/[id]/archivos DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el archivo."), { status: 500 });
  }
}
