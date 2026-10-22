import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const ESTADOS = new Set(["pendiente", "aprobada", "rechazada", "cancelada"]);

const TIPOS = new Set(["vacaciones", "permiso", "licencia", "baja", "otro"]);
const esFecha = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Días corridos entre dos fechas, ambas inclusive. */
function diasEntre(desde: string, hasta: string): number {
  const d = Date.parse(`${desde}T00:00:00Z`);
  const h = Date.parse(`${hasta}T00:00:00Z`);
  return Math.floor((h - d) / 86400000) + 1;
}

/**
 * PATCH /api/rrhh/vacaciones/[id]
 * Body: { estado?, fecha_desde?, fecha_hasta?, tipo_ausencia?, observacion? }
 *
 * Antes solo aceptaba `estado`: una solicitud cargada con la fecha equivocada
 * no se podía corregir, había que cancelarla y volver a cargarla.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ahora = new Date().toISOString();
    const update: Record<string, unknown> = {};

    if (body.estado !== undefined) {
      const estado = String(body.estado).trim();
      if (!ESTADOS.has(estado)) return NextResponse.json(errorResponse("estado inválido"), { status: 400 });
      update.estado = estado;
      update.aprobado_at = estado === "aprobada" ? ahora : null;
      update.cancelado_at = estado === "cancelada" ? ahora : null;
    }

    if (body.tipo_ausencia !== undefined) {
      const t = String(body.tipo_ausencia).trim();
      if (!TIPOS.has(t)) return NextResponse.json(errorResponse("tipo de ausencia inválido"), { status: 400 });
      update.tipo_ausencia = t;
    }

    if (body.observacion !== undefined) {
      update.observacion = String(body.observacion ?? "").trim().slice(0, 500) || null;
    }

    // Las fechas van juntas: cambiar una sola dejaría `dias` sin recalcular.
    if (body.fecha_desde !== undefined || body.fecha_hasta !== undefined) {
      const actual = await ctx.supabase
        .from("empleado_vacaciones")
        .select("fecha_desde, fecha_hasta")
        .eq("id", id).eq("empresa_id", ctx.auth.empresa_id)
        .maybeSingle();
      if (actual.error) return NextResponse.json(errorResponse(actual.error.message), { status: 400 });
      if (!actual.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
      const prev = actual.data as { fecha_desde: string; fecha_hasta: string };

      const desde = body.fecha_desde !== undefined ? body.fecha_desde : prev.fecha_desde;
      const hasta = body.fecha_hasta !== undefined ? body.fecha_hasta : prev.fecha_hasta;
      if (!esFecha(desde) || !esFecha(hasta)) {
        return NextResponse.json(errorResponse("Las fechas deben tener formato AAAA-MM-DD."), { status: 400 });
      }
      if (hasta < desde) {
        return NextResponse.json(errorResponse("La fecha de fin no puede ser anterior a la de inicio."), { status: 400 });
      }
      update.fecha_desde = desde;
      update.fecha_hasta = hasta;
      update.dias = diasEntre(desde, hasta);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("empleado_vacaciones")
      .update(update)
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id);

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
