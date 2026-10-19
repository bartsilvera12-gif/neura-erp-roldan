import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { diasGenerados } from "@/lib/rrhh/vacaciones-dias";

/**
 * GET /api/rrhh/vacaciones/saldos
 *
 * Devuelve saldos por empleado activo + KPIs globales.
 *
 * saldo.disponible = generados - usados (aprobadas tipo=vacaciones).
 * saldo.pendiente_aprobacion = días en estado=pendiente.
 * saldo.proxima_ausencia = primera aprobada del empleado a futuro.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const [empQ, vacQ, polQ] = await Promise.all([
      ctx.supabase.from("empleados")
        .select("id, nombre, cargo, activo, fecha_ingreso")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .order("nombre", { ascending: true }),
      ctx.supabase.from("empleado_vacaciones")
        .select("id, empleado_id, fecha_desde, fecha_hasta, dias, tipo_ausencia, estado, origen")
        .eq("empresa_id", empresaId),
      ctx.supabase.from("rrhh_politica_vacaciones")
        .select("dias_anuales, proporcional_ingreso, tipo_computo, dias_empresa, dias_empleado")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
    ]);
    if (empQ.error) return NextResponse.json(errorResponse(empQ.error.message), { status: 400 });
    if (vacQ.error) return NextResponse.json(errorResponse(vacQ.error.message), { status: 400 });

    const empleados = (empQ.data ?? []) as Array<{ id: string; nombre: string; cargo: string | null; fecha_ingreso: string | null }>;
    const vacaciones = (vacQ.data ?? []) as Array<{
      id: string;
      empleado_id: string;
      fecha_desde: string;
      fecha_hasta: string;
      dias: number;
      tipo_ausencia: string | null;
      estado: string;
      origen: "empresa" | "empleado" | null;
    }>;
    const politica = (polQ.data as { dias_anuales?: number; proporcional_ingreso?: boolean; dias_empresa?: number | null; dias_empleado?: number | null } | null) ?? null;
    const diasAnuales = politica?.dias_anuales ?? 30;
    const proporcional = politica?.proporcional_ingreso !== false;
    const diasEmpresa = politica?.dias_empresa ?? null;
    const diasEmpleado = politica?.dias_empleado ?? null;

    const hoyIso = new Date().toISOString().slice(0, 10);

    const filas = empleados.map((e) => {
      const generados = diasGenerados(e.fecha_ingreso, diasAnuales, proporcional, hoyIso);
      const mias = vacaciones.filter((v) => v.empleado_id === e.id);
      const vacUsadas = mias.filter((v) => v.estado === "aprobada" && (v.tipo_ausencia ?? "vacaciones") === "vacaciones");
      const usados = vacUsadas.reduce((s, v) => s + Number(v.dias ?? 0), 0);
      const usadosEmpresa = vacUsadas.filter((v) => v.origen === "empresa").reduce((s, v) => s + Number(v.dias ?? 0), 0);
      const usadosEmpleado = vacUsadas.filter((v) => v.origen !== "empresa").reduce((s, v) => s + Number(v.dias ?? 0), 0);
      const pendApr = mias
        .filter((v) => v.estado === "pendiente" && (v.tipo_ausencia ?? "vacaciones") === "vacaciones")
        .reduce((s, v) => s + Number(v.dias ?? 0), 0);
      const proxima = mias
        .filter((v) => v.estado === "aprobada" && v.fecha_desde >= hoyIso)
        .sort((a, b) => a.fecha_desde.localeCompare(b.fecha_desde))[0] ?? null;

      // Fase H: si la política define cupos separados empresa/empleado,
      // exponemos el saldo desglosado. La proporcionalidad global sigue
      // aplicando (los cupos se recortan al ratio de días generados vs
      // dias_anuales).
      let cupoEmpresa: number | null = null;
      let cupoEmpleado: number | null = null;
      if (diasAnuales > 0 && (diasEmpresa !== null || diasEmpleado !== null)) {
        const ratio = generados / diasAnuales;
        if (diasEmpresa !== null) cupoEmpresa = Math.floor(diasEmpresa * ratio);
        if (diasEmpleado !== null) cupoEmpleado = Math.floor(diasEmpleado * ratio);
      }

      return {
        empleado_id: e.id,
        empleado_nombre: e.nombre,
        cargo: e.cargo,
        dias_anuales: diasAnuales,
        dias_generados: generados,
        dias_usados: usados,
        dias_pendientes_aprobacion: pendApr,
        dias_disponibles: Math.max(0, generados - usados),
        // Desglose empresa/empleado
        dias_empresa_cupo: cupoEmpresa,
        dias_empleado_cupo: cupoEmpleado,
        dias_empresa_usados: usadosEmpresa,
        dias_empleado_usados: usadosEmpleado,
        dias_empresa_disponibles: cupoEmpresa !== null ? Math.max(0, cupoEmpresa - usadosEmpresa) : null,
        dias_empleado_disponibles: cupoEmpleado !== null ? Math.max(0, cupoEmpleado - usadosEmpleado) : null,
        proxima_ausencia_desde: proxima?.fecha_desde ?? null,
        proxima_ausencia_hasta: proxima?.fecha_hasta ?? null,
      };
    });

    const kpis = {
      empleados_de_vacaciones_hoy: vacaciones
        .filter((v) => v.estado === "aprobada" && v.fecha_desde <= hoyIso && v.fecha_hasta >= hoyIso)
        .length,
      solicitudes_pendientes: vacaciones.filter((v) => v.estado === "pendiente").length,
      aprobadas_este_mes: vacaciones
        .filter((v) => v.estado === "aprobada" && v.fecha_desde.slice(0, 7) === hoyIso.slice(0, 7))
        .length,
      proximas_vacaciones: vacaciones
        .filter((v) => v.estado === "aprobada" && v.fecha_desde > hoyIso)
        .length,
    };

    return NextResponse.json(successResponse({ saldos: filas, kpis }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
