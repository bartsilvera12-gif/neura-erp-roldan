import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";
import {
  AVISO_FALTA_73,
  faltaScript73,
  normalizarLegajo,
  sinColumnas73,
  usuariosDeLaEmpresa,
  validarLegajoYUsuario,
} from "@/lib/rrhh/empleado-vinculo";

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
    // Los usuarios, para el selector de "usuario del sistema" en la ficha.
    const usuarios = puede(perms, "empleados.editar") ? await usuariosDeLaEmpresa(ctx.supabase, ctx.auth.empresa_id) : [];
    return NextResponse.json(successResponse({
      empleado: data,
      usuarios,
      falta_script_73: !("legajo" in (data as object)),
    }));
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
      "nombre","tipo_documento","documento","tipo_contrato","jornada_laboral","hora_entrada_prevista",
      "contacto_emergencia_nombre","contacto_emergencia_telefono","contacto_emergencia_parentesco",
      "observaciones","lugar_nacimiento","nacionalidad","estado_civil","grupo_sanguineo",
      "direccion","email","telefono","cargo","tipo_empleado","tipo_periodo","sucursal_id",
      "chofer_habilitacion","chofer_observacion","comision_politica_id","comision_observacion",
      "departamento","seccion","supervisor","banco","numero_cuenta",
    ].forEach(setStr);
    // Mismo criterio que en el alta: el correo siempre en minúsculas.
    if (typeof update.email === "string") update.email = update.email.toLowerCase();
    ["fecha_nacimiento","fecha_ingreso","fecha_baja","chofer_fecha_venc"].forEach(setDate);
    ["salario_base","salario_complementario","costo_hora"].forEach(setNum);
    ["chofer_km"].forEach(setNumNull);
    ["tolerancia_minutos"].forEach(setNum);
    ["participa_comisiones","cobrar_con_cheque","excluir_liquidaciones","activo"].forEach(setBool);

    if (body.estado !== undefined) {
      const e = String(body.estado);
      if (["activo","baja","suspendido","pendiente"].includes(e)) update.estado = e;
    }
    if (body.moneda !== undefined && ["PYG","USD"].includes(String(body.moneda))) update.moneda = body.moneda;
    // Legajo y usuario del sistema (script 73). Un legajo vacío no se guarda
    // como vacío: el empleado se queda con el que tenía.
    if (body.legajo !== undefined) {
      const l = normalizarLegajo(body.legajo);
      if (l) update.legajo = l;
    }
    if (body.usuario_id !== undefined) update.usuario_id = body.usuario_id ? String(body.usuario_id) : null;
    const invalido = await validarLegajoYUsuario(
      ctx.supabase,
      ctx.auth.empresa_id,
      { legajo: (update.legajo as string | undefined) ?? null, usuario_id: (update.usuario_id as string | null | undefined) ?? null },
      id
    );
    if (invalido) return NextResponse.json(errorResponse(invalido), { status: 409 });

    if (Array.isArray(body.tipos_empleado)) {
      update.tipos_empleado = Array.from(new Set(
        (body.tipos_empleado as unknown[]).map((v) => String(v ?? "").trim().toLowerCase()).filter((s) => s.length > 0)
      ));
    }

    const escribir = (patch: Record<string, unknown>) =>
      ctx.supabase
        .from("empleados")
        .update(patch)
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .select()
        .single();
    let { data, error } = await escribir(update);
    let aviso: string | undefined;
    if (error && faltaScript73(error.message)) {
      ({ data, error } = await escribir(sinColumnas73(update)));
      aviso = AVISO_FALTA_73;
    }
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ empleado: data, ...(aviso ? { aviso } : {}) }));
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
