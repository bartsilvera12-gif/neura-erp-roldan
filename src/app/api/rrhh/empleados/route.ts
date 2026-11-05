import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";
import { entradaPrincipal, normalizarHorario } from "@/lib/rrhh/horario";
import {
  normalizarLegajo,
  siguienteLegajo,
  escribirEmpleado,
  usuariosDeLaEmpresa,
  validarLegajoYUsuario,
} from "@/lib/rrhh/empleado-vinculo";

/**
 * GET /api/rrhh/empleados — lista todos los empleados del tenant.
 *
 * Cada empleado trae el nombre de su usuario del sistema, si tiene. A quien
 * puede editar se le manda además la lista de usuarios, para el selector.
 */
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

    const usuarios = await usuariosDeLaEmpresa(ctx.supabase, ctx.auth.empresa_id);
    const porId = new Map(usuarios.map((u) => [u.id, u]));
    const empleados = ((data ?? []) as Array<Record<string, unknown>>).map((e) => {
      const u = e.usuario_id ? porId.get(String(e.usuario_id)) : undefined;
      return { ...e, usuario_nombre: u ? (u.nombre || u.email) : null, usuario_email: u?.email ?? null };
    });
    // Si la primera fila no trae la columna, el script 73 no corrió todavía.
    const falta73 = (data ?? []).length > 0 && !("legajo" in ((data ?? [])[0] as object));
    const falta74 = (data ?? []).length > 0 && !("horario_semanal" in ((data ?? [])[0] as object));

    return NextResponse.json(successResponse({
      empleados,
      usuarios: puede(perms, "empleados.editar") ? usuarios : [],
      falta_script_74: falta74,
      ...(falta73 ? { aviso: "Falta correr 73_legajo_y_usuario_del_empleado.sql: todavía no se pueden cargar códigos de empleado ni usuarios." } : {}),
    }));
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

    // Legajo: el que se cargó, o el siguiente de la serie si quedó vacío.
    const legajo = normalizarLegajo(body.legajo) ?? (await siguienteLegajo(ctx.supabase, ctx.auth.empresa_id));
    const usuarioId = str("usuario_id");
    const invalido = await validarLegajoYUsuario(ctx.supabase, ctx.auth.empresa_id, { legajo, usuario_id: usuarioId });
    if (invalido) return NextResponse.json(errorResponse(invalido), { status: 409 });

    const horario = normalizarHorario(body.horario_semanal);

    const insert = {
      empresa_id: ctx.auth.empresa_id,
      nombre,
      legajo,
      usuario_id: usuarioId,
      tipo_documento: str("tipo_documento") ?? "CI",
      documento: str("documento"),
      estado,
      tipo_contrato: str("tipo_contrato"),
      jornada_laboral: str("jornada_laboral"),
      // Horario por día (script 74). La columna vieja queda con la primera
      // entrada de la semana, para lo que todavía la lee.
      horario_semanal: horario,
      hora_entrada_prevista: entradaPrincipal(horario) ?? str("hora_entrada_prevista"),
      tolerancia_minutos: Math.max(0, numv("tolerancia_minutos")),
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
      ciudad: str("ciudad"),
      barrio: str("barrio"),
      // Un correo en mayúsculas sigue siendo el mismo correo, pero se ve mal
      // y no coincide al buscarlo: se guarda siempre en minúsculas.
      email: str("email")?.toLowerCase() ?? null,
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

    const { data, error, avisos } = await escribirEmpleado(
      (payload) => ctx.supabase.from("empleados").insert([payload]).select().single(),
      insert
    );
    const aviso = avisos.length ? avisos.join(" ") : undefined;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ empleado: data, ...(aviso ? { aviso } : {}) }), { status: 201 });
  } catch (err) {
    console.error("[/api/rrhh/empleados POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al crear empleado"), { status: 500 });
  }
}
