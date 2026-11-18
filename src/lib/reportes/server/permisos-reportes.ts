import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { puedeVerReporte, soloReportesConocidos } from "@/lib/reportes/permisos-reportes";

/**
 * Los reportes que ve este usuario: "todos" para la administración (o en una
 * base sin el script 90), si no la lista tildada en su ficha. Sin nada
 * tildado, ninguno.
 */
export async function reportesPermitidosDe(
  sb: AppSupabaseClient,
  auth: { empresa_id: string; rol?: string | null; usuarioCatalogId?: string | null } & Parameters<typeof isAdmin>[0]
): Promise<string[] | "todos"> {
  if (isAdmin(auth)) return "todos";
  const uid = auth?.usuarioCatalogId ?? null;
  if (!uid) return [];
  const r = await sb.from("usuarios").select("reportes_permitidos").eq("id", uid).maybeSingle();
  if (r.error) {
    // Sin el script 90 no existe la columna: se deja como antes.
    return /reportes_permitidos/.test(r.error.message) ? "todos" : [];
  }
  return soloReportesConocidos((r.data as { reportes_permitidos?: unknown } | null)?.reportes_permitidos);
}

/**
 * Para el comienzo de cada API de reporte:
 *
 *   const bloqueo = await bloqueoReporte(request, "ganancias");
 *   if (bloqueo) return bloqueo;
 *
 * Esconder la tarjeta no alcanza: los datos se pueden pedir directo.
 */
export async function bloqueoReporte(request: Request, clave: string): Promise<NextResponse | null> {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const permitidos = await reportesPermitidosDe(ctx.supabase, ctx.auth);
  if (puedeVerReporte(clave, permitidos)) return null;
  return NextResponse.json(
    errorResponse("Este reporte no está habilitado para tu usuario. Pedíselo a un administrador."),
    { status: 403 }
  );
}
