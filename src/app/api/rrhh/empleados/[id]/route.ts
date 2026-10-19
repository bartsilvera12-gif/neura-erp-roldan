import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";

/** GET /api/rrhh/empleados/[id] */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "empleados.ver")) return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });

    const { id } = await ctxParams.params;
    const { data, error } = await ctx.supabase
      .from("empleados")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Empleado no encontrado"), { status: 404 });
    return NextResponse.json(successResponse({ empleado: data }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/:id GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}

/** PATCH /api/rrhh/empleados/[id] */
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "empleados.editar")) return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });

    const { id } = await ctxParams.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const update: Record<string, unknown> = {};
    const setStr = (k: string) => { if (body[k] !== undefined) update[k] = body[k] ? String(body[k]).trim() || null : null; };
    const setDate = (k: string) => { if (body[k] !== undefined) update[k] = body[k] ? String(body[k]) : null; };
    const setNum = (k: string) => {
      if (body[k] !== undefined) {
        const n = Number(body[k]);
        update[k] = Number.isFinite(n) ? n : 0;
      }
    };
    const setNumNull = (k: string) => {
      if (body[k] !== undefined) {
        if (body[k] === null || body[k] === "") { update[k] = null; return; }
        const n = Number(body[k]);
        update[k] = Number.isFinite(n) ? n : null;
      }
    };
    const setBool = (k: string) => { if (body[k] !== undefined) update[k] = Boolean(body[k]); };

    [
      "nombre","tipo_documento","documento","tipo_contrato","jornada_laboral",
      "contacto_emergencia_nombre","contacto_emergencia_telefono","contacto_emergencia_parentesco",
      "observaciones","lugar_nacimiento","nacionalidad","estado_civil","grupo_sanguineo",
      "direccion","email","telefono","cargo","tipo_empleado","tipo_periodo","sucursal_id",
      "chofer_habilitacion","chofer_observacion","comision_politica_id","comision_observacion",
      "departamento","seccion","supervisor","banco","numero_cuenta",
    ].forEach(setStr);
    ["fecha_nacimiento","fecha_ingreso","fecha_baja","chofer_fecha_venc"].forEach(setDate);
    ["salario_base","salario_complementario","costo_hora"].forEach(setNum);
    ["chofer_km"].forEach(setNumNull);
    ["participa_comisiones","cobrar_con_cheque","excluir_liquidaciones","activo"].forEach(setBool);

    if (body.estado !== undefined) {
      const e = String(body.estado);
      if (["activo","baja","suspendido","pendiente"].includes(e)) update.estado = e;
    }
    if (body.moneda !== undefined && ["PYG","USD"].includes(String(body.moneda))) update.moneda = body.moneda;
    if (Array.isArray(body.tipos_empleado)) {
      update.tipos_empleado = Array.from(new Set(
        (body.tipos_empleado as unknown[]).map((v) => String(v ?? "").trim().toLowerCase()).filter((s) => s.length > 0)
      ));
    }

    const { data, error } = await ctx.supabase
      .from("empleados")
      .update(update)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ empleado: data }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/:id PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}

/** DELETE /api/rrhh/empleados/[id] — soft delete (marca activo=false, estado='baja'). */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "empleados.editar")) return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });

    const { id } = await ctxParams.params;
    const { error } = await ctx.supabase
      .from("empleados")
      .update({ activo: false, estado: "baja", fecha_baja: new Date().toISOString().slice(0, 10) })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/rrhh/empleados/:id DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}
