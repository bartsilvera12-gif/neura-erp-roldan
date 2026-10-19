/**
 * Storage helpers para archivos / documentación de empleado.
 *
 * Bucket: `empleado-archivos` (privado).
 * Path:   `{empresa_id}/{empleado_id}/{archivo_id}.{ext}`
 *
 * Mismo patrón que proyecto-archivos: el primer segmento del path es
 * `empresa_id` y los endpoints siempre validan el empresa_id del usuario
 * antes de leer/escribir.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const EMPLEADO_ARCHIVOS_BUCKET = "empleado-archivos";

export const ALLOWED_ARCHIVO_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

export const MAX_ARCHIVO_BYTES = 25 * 1024 * 1024;

let bucketEnsured = false;

export async function ensureEmpleadoArchivosBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(EMPLEADO_ARCHIVOS_BUCKET);
    if (existing) {
      bucketEnsured = true;
      return;
    }
  } catch {
    // fallthrough
  }
  const { error } = await supabase.storage.createBucket(EMPLEADO_ARCHIVOS_BUCKET, {
    public: false,
    fileSizeLimit: MAX_ARCHIVO_BYTES,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`No se pudo crear el bucket de archivos: ${error.message}`);
  }
  bucketEnsured = true;
}

export function buildEmpleadoArchivoPath(opts: {
  empresaId: string;
  empleadoId: string;
  archivoId: string;
  mime: string;
}): string {
  const ext = MIME_TO_EXT[opts.mime] ?? "bin";
  return `${opts.empresaId}/${opts.empleadoId}/${opts.archivoId}.${ext}`;
}

export async function signEmpleadoArchivo(
  supabase: AppSupabaseClient,
  path: string | null | undefined,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(EMPLEADO_ARCHIVOS_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export function pathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  return path.split("/")[0] === empresaId;
}
