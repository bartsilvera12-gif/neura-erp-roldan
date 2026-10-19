import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/rrhh/empleados/[id]/especialidades — devuelve las asignaciones
 * con datos del catálogo (nombre, slug).
 *
 * PUT /api/rrhh/empleados/[id]/especialidades — reemplaza todas las
 * especialidades del empleado.
 * Body: {
 *   items: Array<{ especialidad_id, es_principal?, nivel?, observaciones? }>
 * }
 */

const NIVELES = ["aprendiz","intermedio","especialista","encargado"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const { data, error } = await ctx.supabase
      .from("empleado_especialidades")
      .select("id, especialidad_id, es_principal, nivel, observaciones, especialidades(nombre, slug)")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("empleado_id", id)
      .order("es_principal", { ascending: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ especialidades: data ?? [] }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { items?: Array<Record<string, unknown>> };
    const items = Array.isArray(body.items) ? body.items : [];

    // Validaciones ligeras: una sola principal
    const principales = items.filter((it) => Boolean(it.es_principal));
    if (principales.length > 1) {
      return NextResponse.json(errorResponse("Sólo puede haber una especialidad principal"), { status: 400 });
    }
    for (const it of items) {
      if (it.nivel && !NIVELES.includes(String(it.nivel) as typeof NIVELES[number])) {
        return NextResponse.json(errorResponse(`Nivel inválido: ${it.nivel}`), { status: 400 });
      }
    }

    // Reemplazo total (delete + insert)
    const del = await ctx.supabase
      .from("empleado_especialidades")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("empleado_id", id);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 400 });

    if (items.length > 0) {
      const rows = items.map((it) => ({
        empresa_id: ctx.auth.empresa_id,
        empleado_id: id,
        especialidad_id: String(it.especialidad_id ?? ""),
        es_principal: Boolean(it.es_principal),
        nivel: it.nivel ? String(it.nivel) : null,
        observaciones: it.observaciones ? String(it.observaciones).trim() || null : null,
        created_by: ctx.auth.user?.id ?? null,
      })).filter((r) => r.especialidad_id);
      if (rows.length > 0) {
        const { error } = await ctx.supabase.from("empleado_especialidades").insert(rows);
        if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
      }
    }

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
