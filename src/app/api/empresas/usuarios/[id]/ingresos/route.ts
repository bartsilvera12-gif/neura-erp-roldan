import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";

/**
 * GET /api/empresas/usuarios/[id]/ingresos — los últimos ingresos de un
 * usuario y desde qué equipo (script 92). Solo administración.
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  if (!isAdmin(ctx.auth)) {
    return NextResponse.json(errorResponse("Los ingresos de un usuario los ve un administrador."), { status: 403 });
  }
  const { id } = await ctxParams.params;
  const r = await ctx.supabase
    .from("usuario_ingresos")
    .select("created_at, dispositivo_id, dispositivo_nombre, sistema, navegador, ip, sucursal_id")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("usuario_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (r.error) {
    if (/usuario_ingresos|does not exist|42P01|schema cache/i.test(r.error.message)) {
      return NextResponse.json(successResponse({
        disponible: false,
        aviso: "Falta correr el script 92: todavía no se registran los ingresos.",
        ingresos: [],
      }));
    }
    return NextResponse.json(errorResponse(r.error.message), { status: 500 });
  }
  return NextResponse.json(successResponse({ disponible: true, aviso: null, ingresos: r.data ?? [] }));
}
