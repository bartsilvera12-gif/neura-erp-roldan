import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { saldoVacacionesPy } from "@/lib/rrhh/vacaciones-py";

/**
 * GET /api/rrhh/vacaciones/saldos
 *
 * Saldo de vacaciones de cada empleado activo según la ley paraguaya
 * (art. 218 del Código del Trabajo, ver lib/rrhh/vacaciones-py.ts): el derecho
 * nace en cada aniversario de ingreso, con 12, 18 o 30 días hábiles según la
 * antigüedad, y se acumulan hasta dos períodos.
 *
 * Antes era la regla de España: 30 días naturales para todos, generados en
 * proporción al año calendario.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const [empQ, vacQ] = await Promise.all([
      ctx.supabase.from("empleados")
        .select("id, nombre, cargo, activo, fecha_ingreso")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .order("nombre", { ascending: true }),
      ctx.supabase.from("empleado_vacaciones")
        .select("id, empleado_id, fecha_desde, fecha_hasta, dias, tipo_ausencia, estado")
        .eq("empresa_id", empresaId),
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
    }>;

    // Hoy en Paraguay (UTC−3), no en UTC.
    const hoyIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const esVacacion = (v: { tipo_ausencia: string | null }) => (v.tipo_ausencia ?? "vacaciones") === "vacaciones";

    const filas = empleados.map((e) => {
      const mias = vacaciones.filter((v) => v.empleado_id === e.id);
      const usos = mias
        .filter((v) => v.estado === "aprobada" && esVacacion(v))
        .map((v) => ({ fecha_desde: String(v.fecha_desde).slice(0, 10), dias: Number(v.dias ?? 0) }));
      const saldo = saldoVacacionesPy(e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : null, hoyIso, usos);
      const pendApr = mias
        .filter((v) => v.estado === "pendiente" && esVacacion(v))
        .reduce((s, v) => s + Number(v.dias ?? 0), 0);
      const proxima = mias
        .filter((v) => v.estado === "aprobada" && v.fecha_desde >= hoyIso)
        .sort((a, b) => a.fecha_desde.localeCompare(b.fecha_desde))[0] ?? null;

      return {
        empleado_id: e.id,
        empleado_nombre: e.nombre,
        cargo: e.cargo,
        fecha_ingreso: e.fecha_ingreso,
        ...saldo,
        dias_pendientes_aprobacion: pendApr,
        proxima_ausencia_desde: proxima?.fecha_desde ?? null,
        proxima_ausencia_hasta: proxima?.fecha_hasta ?? null,
      };
    });

    const kpis = {
      de_vacaciones_hoy: vacaciones
        .filter((v) => v.estado === "aprobada" && v.fecha_desde <= hoyIso && v.fecha_hasta >= hoyIso)
        .length,
      solicitudes_pendientes: vacaciones.filter((v) => v.estado === "pendiente").length,
      proximas: vacaciones.filter((v) => v.estado === "aprobada" && v.fecha_desde > hoyIso).length,
      sin_fecha_ingreso: empleados.filter((e) => !e.fecha_ingreso).length,
    };

    return NextResponse.json(successResponse({ saldos: filas, kpis, hoy: hoyIso }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
