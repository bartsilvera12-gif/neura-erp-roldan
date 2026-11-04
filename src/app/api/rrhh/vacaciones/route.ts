import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { contarDiasAusencia } from "@/lib/rrhh/server/dias-ausencia";
import { saldoVacacionesPy } from "@/lib/rrhh/vacaciones-py";

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
 * Días como se cuentan en Paraguay: vacaciones en días hábiles (lunes a
 * sábado, sin feriados); el resto, corridos. Ver contarDiasAusencia.
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

    const polQ = await ctx.supabase
      .from("rrhh_politica_vacaciones")
      .select("requiere_aprobacion, permitir_saldo_negativo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();
    const requiereAprob = (polQ.data as { requiere_aprobacion?: boolean } | null)?.requiere_aprobacion !== false;

    const { dias } = await contarDiasAusencia(ctx.supabase, ctx.auth.empresa_id, desde, hasta, tipo);
    if (dias <= 0) {
      return NextResponse.json(
        errorResponse(tipo === "vacaciones"
          ? "En ese rango no hay ningún día hábil (son domingos o feriados)."
          : "Los días calculados son 0. Revisá el rango."),
        { status: 400 }
      );
    }

    // Más días de los que tiene: solo si la política permite adelantar.
    // La casilla existía y no la miraba nadie.
    const permiteAdelanto = (polQ.data as { permitir_saldo_negativo?: boolean } | null)?.permitir_saldo_negativo === true;
    if (tipo === "vacaciones" && !permiteAdelanto) {
      const [empQ, usosQ] = await Promise.all([
        ctx.supabase.from("empleados").select("fecha_ingreso").eq("empresa_id", ctx.auth.empresa_id).eq("id", empleadoId).maybeSingle(),
        ctx.supabase.from("empleado_vacaciones").select("fecha_desde, dias, tipo_ausencia")
          .eq("empresa_id", ctx.auth.empresa_id).eq("empleado_id", empleadoId).eq("estado", "aprobada"),
      ]);
      if (empQ.error) return NextResponse.json(errorResponse(empQ.error.message), { status: 400 });
      const ingreso = (empQ.data as { fecha_ingreso?: string | null } | null)?.fecha_ingreso ?? null;
      if (!ingreso) {
        return NextResponse.json(
          errorResponse("El empleado no tiene fecha de ingreso: sin ella no se puede saber cuántos días le corresponden. Cargala en su ficha."),
          { status: 400 }
        );
      }
      const usos = ((usosQ.data ?? []) as Array<{ fecha_desde: string; dias: number; tipo_ausencia: string | null }>)
        .filter((u) => (u.tipo_ausencia ?? "vacaciones") === "vacaciones")
        .map((u) => ({ fecha_desde: String(u.fecha_desde).slice(0, 10), dias: Number(u.dias) || 0 }));
      const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const saldo = saldoVacacionesPy(String(ingreso).slice(0, 10), hoy, usos);
      if (dias > saldo.dias_disponibles) {
        const motivo = saldo.anios === 0
          ? `todavía no cumplió su primer año (lo cumple el ${saldo.proximo_derecho_fecha?.split("-").reverse().join("/")})`
          : `tiene ${Math.max(0, saldo.dias_disponibles)} día${saldo.dias_disponibles === 1 ? "" : "s"} disponible${saldo.dias_disponibles === 1 ? "" : "s"}`;
        return NextResponse.json(
          errorResponse(`Son ${dias} días hábiles y ${motivo}. Para adelantar vacaciones, habilitalo en la Política de vacaciones.`),
          { status: 400 }
        );
      }
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
