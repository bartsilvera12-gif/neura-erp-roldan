import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { notificacionesDe, puestoDe, clavesLeidas } from "@/lib/notificaciones/server/notificaciones";

/**
 * GET /api/notificaciones — los avisos de la campana para quien pregunta,
 * según su puesto, sin los que ya leyó (ver `notificaciones.ts`).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const esAdmin = isAdmin(ctx.auth);
    const puesto = await puestoDe(ctx.supabase, ctx.auth, esAdmin);
    const mios = [...new Set([ctx.auth.usuarioCatalogId, ctx.auth.user?.id].filter((v): v is string => !!v))];
    const [todas, leidas] = await Promise.all([
      notificacionesDe(ctx.supabase, {
        empresaId: ctx.auth.empresa_id,
        sucursalId: ctx.auth.sucursal_id ?? null,
        puesto,
        mios,
      }),
      clavesLeidas(ctx.supabase, ctx.auth.empresa_id, ctx.auth.usuarioCatalogId ?? null),
    ]);
    const notificaciones = todas.filter((x) => !leidas.claves.has(x.clave));
    return NextResponse.json(successResponse({
      notificaciones,
      puesto,
      puede_marcar: esAdmin,
      // Sin el script 96 lo leído lo recuerda la pantalla.
      guarda_leidas: leidas.tabla,
    }));
  } catch (err) {
    console.error("[/api/notificaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(successResponse({ notificaciones: [], puesto: null, puede_marcar: false, guarda_leidas: false }));
  }
}
