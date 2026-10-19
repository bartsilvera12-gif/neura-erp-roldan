import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";

/** GET /api/rrhh/empleados — lista todos los empleados del tenant. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "empleados.ver")) return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });

    const { data, error } = await ctx.supabase
      .from("empleados")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("nombre", { ascending: true });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ empleados: data ?? [] }));
  } catch (err) {
    console.error("[/api/rrhh/empleados GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al listar empleados"), { status: 500 });
  }
}

/** POST /api/rrhh/empleados — crea un empleado. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "empleados.editar")) return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });

    const str = (k: string): string | null => body[k] ? String(body[k]).trim() || null : null;
    const date = (k: string): string | null => body[k] ? String(body[k]) : null;
    const numv = (k: string): number => Number(body[k]) || 0;
    const numn = (k: string): number | null => {
      if (body[k] === undefined || body[k] === null || body[k] === "") return null;
      const n = Number(body[k]);
      return Number.isFinite(n) ? n : null;
    };
    const bool = (k: string): boolean => Boolean(body[k]);

    const tiposEmpleadoRaw = Array.isArray(body.tipos_empleado)
      ? (body.tipos_empleado as unknown[]).map((v) => String(v ?? "").trim().toLowerCase()).filter((s) => s.length > 0)
      : [];
    const tiposEmpleado = Array.from(new Set(tiposEmpleadoRaw));

    const estadoRaw = str("estado");
    const estado = estadoRaw && ["activo","baja","suspendido","pendiente"].includes(estadoRaw)
      ? estadoRaw
      : (body.activo === false ? "baja" : "activo");

    const moneda = ["PYG","USD"].includes(String(body.moneda ?? "")) ? String(body.moneda) : "PYG";

    const insert = {
      empresa_id: ctx.auth.empresa_id,
      nombre,
      tipo_documento: str("tipo_documento") ?? "CI",
      documento: str("documento"),
      estado,
      tipo_contrato: str("tipo_contrato"),
      jornada_laboral: str("jornada_laboral"),
      contacto_emergencia_nombre: str("contacto_emergencia_nombre"),
      contacto_emergencia_telefono: str("contacto_emergencia_telefono"),
      contacto_emergencia_parentesco: str("contacto_emergencia_parentesco"),
      observaciones: str("observaciones"),
      created_by: ctx.auth.user?.id ?? null,
      fecha_nacimiento: date("fecha_nacimiento"),
      lugar_nacimiento: str("lugar_nacimiento"),
      nacionalidad: str("nacionalidad") ?? "Paraguaya",
      estado_civil: str("estado_civil"),
      grupo_sanguineo: str("grupo_sanguineo"),
      direccion: str("direccion"),
      email: str("email"),
      telefono: str("telefono"),
      cargo: str("cargo"),
      fecha_ingreso: date("fecha_ingreso"),
      fecha_baja: date("fecha_baja"),
      tipo_empleado: str("tipo_empleado"),
      tipo_periodo: str("tipo_periodo") ?? "mensual",
      tipos_empleado: tiposEmpleado,
      sucursal_id: str("sucursal_id"),
      chofer_habilitacion: str("chofer_habilitacion"),
      chofer_fecha_venc: date("chofer_fecha_venc"),
      chofer_km: numn("chofer_km"),
      chofer_observacion: str("chofer_observacion"),
      participa_comisiones: bool("participa_comisiones"),
      comision_politica_id: str("comision_politica_id"),
      comision_observacion: str("comision_observacion"),
      departamento: str("departamento"),
      seccion: str("seccion"),
      supervisor: str("supervisor"),
      salario_base: numv("salario_base"),
      salario_complementario: numv("salario_complementario"),
      costo_hora: numv("costo_hora"),
      moneda,
      banco: str("banco"),
      numero_cuenta: str("numero_cuenta"),
      cobrar_con_cheque: bool("cobrar_con_cheque"),
      excluir_liquidaciones: bool("excluir_liquidaciones"),
      activo: body.activo === undefined ? true : Boolean(body.activo),
    };

    const { data, error } = await ctx.supabase.from("empleados").insert([insert]).select().single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ empleado: data }), { status: 201 });
  } catch (err) {
    console.error("[/api/rrhh/empleados POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al crear empleado"), { status: 500 });
  }
}
