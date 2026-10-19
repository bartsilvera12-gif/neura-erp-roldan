import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { calcularDias } from "@/lib/rrhh/vacaciones-dias";

const TIPOS_AUSENCIA = new Set([
  "vacaciones",
  "permiso_retribuido",
  "baja_medica",
  "ausencia_sin_sueldo",
  "otro",
]);

/**
 * GET /api/rrhh/vacaciones?empleadoId=<uuid>
 * Lista solicitudes (todas o filtradas por empleado).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const empleadoId = sp.get("empleadoId");

    let q = ctx.supabase
      .from("empleado_vacaciones")
      .select(
        "id, empleado_id, fecha_desde, fecha_hasta, dias, tipo_ausencia, estado, observacion, aprobado_at, cancelado_at, created_at, " +
        "empleados:empleado_id(nombre, cargo)"
      )
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("fecha_desde", { ascending: false });
    if (empleadoId) q = q.eq("empleado_id", empleadoId);

    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const solicitudes = rows.map((row) => {
      const emp = row.empleados as { nombre?: string; cargo?: string | null } | { nombre?: string; cargo?: string | null }[] | null;
      const e = Array.isArray(emp) ? emp[0] : emp;
      return { ...row, empleado_nombre: e?.nombre ?? null, empleado_cargo: e?.cargo ?? null, empleados: undefined };
    });

    return NextResponse.json(successResponse({ solicitudes }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/rrhh/vacaciones
 *
 * Body:
 *   empleado_id, fecha_desde, fecha_hasta, tipo_ausencia?, observacion?, modo?
 *
 * modo='admin' → estado='aprobada' al instante. Si no, 'pendiente'.
 * Días se calculan según la política de la empresa (naturales/laborables).
 * Solapamiento: rechaza si hay otra solicitud aprobada del mismo empleado
 * con rango que se cruce.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const empleadoId = String(body.empleado_id ?? "").trim();
    const desde = String(body.fecha_desde ?? "").trim();
    const hasta = String(body.fecha_hasta ?? "").trim();
    const tipoRaw = String(body.tipo_ausencia ?? "vacaciones").trim();
    const tipo = TIPOS_AUSENCIA.has(tipoRaw) ? tipoRaw : "vacaciones";
    const modo = String(body.modo ?? "").trim();

    if (!empleadoId) return NextResponse.json(errorResponse("Falta empleado_id"), { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(errorResponse("Fechas inválidas (YYYY-MM-DD)"), { status: 400 });
    }
    if (hasta < desde) return NextResponse.json(errorResponse("fecha_hasta debe ser >= fecha_desde"), { status: 400 });

    // Leer política para tipo de cómputo y flag de aprobación.
    const polQ = await ctx.supabase
      .from("rrhh_politica_vacaciones")
      .select("tipo_computo, requiere_aprobacion")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();
    const forzarComputo = String(body.forzar_computo ?? "").trim();
    const tipoComputo: "naturales" | "laborables" =
      forzarComputo === "laborables" || forzarComputo === "naturales"
        ? (forzarComputo as "laborables" | "naturales")
        : (polQ.data as { tipo_computo?: string } | null)?.tipo_computo === "laborables"
          ? "laborables"
          : "naturales";
    const requiereAprob = (polQ.data as { requiere_aprobacion?: boolean } | null)?.requiere_aprobacion !== false;

    const dias = calcularDias(desde, hasta, tipoComputo);
    if (dias <= 0) {
      return NextResponse.json(errorResponse("Los días calculados son 0. Revisá el rango."), { status: 400 });
    }

    // Solapamiento con aprobadas (solo para tipo='vacaciones' — los otros tipos
    // pueden coexistir con vacaciones aprobadas).
    if (tipo === "vacaciones") {
      const overlap = await ctx.supabase
        .from("empleado_vacaciones")
        .select("id")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("empleado_id", empleadoId)
        .eq("estado", "aprobada")
        .lte("fecha_desde", hasta)
        .gte("fecha_hasta", desde)
        .limit(1);
      if (!overlap.error && (overlap.data ?? []).length > 0) {
        return NextResponse.json(
          errorResponse("El empleado ya tiene vacaciones aprobadas que se solapan con este rango."),
          { status: 400 }
        );
      }
    }

    const ahora = new Date().toISOString();
    const estadoInicial: "pendiente" | "aprobada" =
      modo === "admin" || !requiereAprob ? "aprobada" : "pendiente";

    const ins = await ctx.supabase
      .from("empleado_vacaciones")
      .insert([{
        empresa_id: ctx.auth.empresa_id,
        empleado_id: empleadoId,
        fecha_desde: desde,
        fecha_hasta: hasta,
        dias,
        tipo_ausencia: tipo,
        estado: estadoInicial,
        observacion: body.observacion ? String(body.observacion).trim() : null,
        origen: body.origen === "empresa" ? "empresa" : "empleado",
        aprobado_at: estadoInicial === "aprobada" ? ahora : null,
      }])
      .select()
      .single();
    if (ins.error) return NextResponse.json(errorResponse(ins.error.message), { status: 400 });

    return NextResponse.json(successResponse({ solicitud: ins.data, dias_calculados: dias }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
