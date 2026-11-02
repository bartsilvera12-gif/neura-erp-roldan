import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const FALTA_TABLA = "Falta correr 48_modificaciones_administrativas.sql.";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reportes/modificaciones?desde=&hasta=&entidad=&persona=
 *
 * Lo que tocó el administrador. Solo lo ve un administrador: es la lista de
 * quién cambió qué, y dársela a cualquiera convierte una herramienta de
 * control en material de pasillo.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede ver las modificaciones administrativas."),
        { status: 403 }
      );
    }

    const sp = new URL(request.url).searchParams;
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
    const entidad = (sp.get("entidad") ?? "").trim();

    let q = ctx.supabase
      .from("modificaciones_administrativas")
      .select("id, entidad, entidad_id, referencia, accion, detalle, motivo, usuario_nombre, es_admin, created_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (desde) q = q.gte("created_at", `${desde}T00:00:00-03:00`);
    if (hasta) q = q.lte("created_at", `${hasta}T23:59:59.999-03:00`);
    if (entidad) q = q.eq("entidad", entidad);

    const { data, error } = await q;
    if (error) {
      if (/modificaciones_administrativas/.test(error.message)) {
        return NextResponse.json(successResponse({ movimientos: [], disponible: false, aviso: FALTA_TABLA }));
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ movimientos: data ?? [], disponible: true }));
  } catch (err) {
    console.error("[/api/reportes/modificaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las modificaciones."), { status: 500 });
  }
}
