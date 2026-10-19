import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_ARCHIVO_MIME,
  MAX_ARCHIVO_BYTES,
  EMPLEADO_ARCHIVOS_BUCKET,
  ensureEmpleadoArchivosBucket,
  signEmpleadoArchivo,
} from "@/lib/rrhh/empleado-archivos-storage";

const TIPOS = ["curso","certificado","habilitacion","documento_legal"] as const;

function estadoCalc(fechaVenc: string | null): "vigente" | "por_vencer" | "vencido" | "pendiente" {
  if (!fechaVenc) return "pendiente";
  const hoy = new Date();
  const venc = new Date(fechaVenc + "T00:00:00");
  const diff = (venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return "vencido";
  if (diff <= 30) return "por_vencer";
  return "vigente";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt", "text/csv": "csv",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("empleado_cursos")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("empleado_id", id)
      .order("fecha_vencimiento", { ascending: true, nullsFirst: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as Array<Record<string, unknown> & { storage_path: string | null; fecha_vencimiento: string | null; estado: string }>;
    // Refrescar estado calculado + firmar url si hay archivo
    const cursos = await Promise.all(rows.map(async (r) => ({
      ...r,
      estado_calc: estadoCalc(r.fecha_vencimiento),
      url: r.storage_path ? await signEmpleadoArchivo(ctx.supabase, r.storage_path, 3600) : null,
    })));
    return NextResponse.json(successResponse({ cursos }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

/** POST — soporta multipart (con archivo opcional) o JSON. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id: empleadoId } = await params;
    const empresaId = ctx.auth.empresa_id;

    const contentType = request.headers.get("content-type") ?? "";
    let payload: Record<string, unknown> = {};
    let file: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const raw = form.get("file");
      if (raw instanceof File && raw.size > 0) file = raw;
      for (const [k, v] of form.entries()) {
        if (k === "file") continue;
        payload[k] = typeof v === "string" ? v : String(v);
      }
    } else {
      payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    }

    const nombre = String(payload.nombre ?? "").trim();
    if (!nombre) return NextResponse.json(errorResponse("nombre obligatorio"), { status: 400 });
    const tipo = String(payload.tipo ?? "curso");
    if (!TIPOS.includes(tipo as typeof TIPOS[number])) return NextResponse.json(errorResponse("tipo inválido"), { status: 400 });

    const fechaVenc = payload.fecha_vencimiento ? String(payload.fecha_vencimiento) : null;
    const insert: Record<string, unknown> = {
      empresa_id: empresaId,
      empleado_id: empleadoId,
      curso_id: payload.curso_id ? String(payload.curso_id) : null,
      nombre,
      tipo,
      entidad_emisora: payload.entidad_emisora ? String(payload.entidad_emisora).trim() || null : null,
      fecha_emision: payload.fecha_emision ? String(payload.fecha_emision) : null,
      fecha_vencimiento: fechaVenc,
      estado: estadoCalc(fechaVenc),
      observaciones: payload.observaciones ? String(payload.observaciones).trim() || null : null,
      created_by: ctx.auth.user?.id ?? null,
    };

    const { data: created, error: insErr } = await ctx.supabase
      .from("empleado_cursos").insert([insert]).select().single();
    if (insErr || !created) return NextResponse.json(errorResponse(insErr?.message ?? "no se pudo crear"), { status: 400 });

    // Subir archivo si vino
    let url: string | null = null;
    if (file) {
      if (!ALLOWED_ARCHIVO_MIME.has(file.type)) {
        return NextResponse.json(successResponse({ curso: created, warning: `Archivo omitido: formato no permitido (${file.type})` }));
      }
      if (file.size > MAX_ARCHIVO_BYTES) {
        return NextResponse.json(successResponse({ curso: created, warning: `Archivo omitido: excede ${(MAX_ARCHIVO_BYTES/1024/1024)|0} MB` }));
      }
      try {
        await ensureEmpleadoArchivosBucket(ctx.supabase);
        const ext = EXT_BY_MIME[file.type] ?? "bin";
        const path = `${empresaId}/${empleadoId}/cursos/${(created as { id: string }).id}.${ext}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const up = await ctx.supabase.storage
          .from(EMPLEADO_ARCHIVOS_BUCKET)
          .upload(path, buf, { contentType: file.type, upsert: true });
        if (!up.error) {
          await ctx.supabase.from("empleado_cursos")
            .update({ storage_bucket: EMPLEADO_ARCHIVOS_BUCKET, storage_path: path, mime_type: file.type, size_bytes: file.size })
            .eq("id", (created as { id: string }).id).eq("empresa_id", empresaId);
          url = await signEmpleadoArchivo(ctx.supabase, path, 3600);
        }
      } catch (e) {
        console.error("[empleado_cursos file upload]", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(successResponse({ curso: { ...created, url, estado_calc: estadoCalc(fechaVenc) } }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
