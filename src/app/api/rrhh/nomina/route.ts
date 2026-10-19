import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/rrhh/nomina?mes=YYYY-MM
 *
 * Nómina del mes calculada en tiempo real desde:
 *  - empleados: salario_base, costo_hora
 *  - empleado_asignaciones del mes (horas trabajadas + costo imputado a obras)
 *  - empleado_fichajes del mes (horas registradas en control horario)
 *  - empleado_vacaciones aprobadas que se solapan con el mes (días)
 *
 * No persiste — cada consulta recalcula. Esto permite ajustes retroactivos
 * (corregir un fichaje, aprobar una vacación) y la nómina se actualiza sola.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const mes = sp.get("mes") ?? new Date().toISOString().slice(0, 7);
    const desde = `${mes}-01`;
    const [y, m] = mes.split("-").map((v) => parseInt(v, 10));
    const hasta = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

    const [empQ, asigQ, fichQ, vacQ] = await Promise.all([
      ctx.supabase
        .from("empleados")
        .select("id, nombre, cargo, salario_base, costo_hora, activo")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("activo", true)
        .order("nombre", { ascending: true }),
      ctx.supabase
        .from("empleado_asignaciones")
        .select("empleado_id, horas, costo_total")
        .eq("empresa_id", ctx.auth.empresa_id)
        .gte("fecha", desde)
        .lt("fecha", hasta),
      ctx.supabase
        .from("empleado_fichajes")
        .select("empleado_id, horas")
        .eq("empresa_id", ctx.auth.empresa_id)
        .gte("fecha", desde)
        .lt("fecha", hasta),
      ctx.supabase
        .from("empleado_vacaciones")
        .select("empleado_id, fecha_desde, fecha_hasta, dias")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("estado", "aprobada"),
    ]);
    if (empQ.error) return NextResponse.json(errorResponse(empQ.error.message), { status: 400 });
    if (asigQ.error) return NextResponse.json(errorResponse(asigQ.error.message), { status: 400 });
    if (fichQ.error) return NextResponse.json(errorResponse(fichQ.error.message), { status: 400 });
    if (vacQ.error) return NextResponse.json(errorResponse(vacQ.error.message), { status: 400 });

    const num = (v: unknown) => Number(v ?? 0) || 0;

    // Agregar por empleado_id
    const asigPorEmp = new Map<string, { horas: number; costo: number }>();
    for (const r of (asigQ.data ?? []) as Array<{ empleado_id: string; horas: number | string; costo_total: number | string }>) {
      const acc = asigPorEmp.get(r.empleado_id) ?? { horas: 0, costo: 0 };
      acc.horas += num(r.horas);
      acc.costo += num(r.costo_total);
      asigPorEmp.set(r.empleado_id, acc);
    }
    const fichPorEmp = new Map<string, number>();
    for (const r of (fichQ.data ?? []) as Array<{ empleado_id: string; horas: number | string }>) {
      fichPorEmp.set(r.empleado_id, (fichPorEmp.get(r.empleado_id) ?? 0) + num(r.horas));
    }
    const vacPorEmp = new Map<string, number>();
    for (const r of (vacQ.data ?? []) as Array<{ empleado_id: string; fecha_desde: string; fecha_hasta: string; dias: number | string }>) {
      // Calcular días de la vacación que caen dentro del mes
      const ini = r.fecha_desde > desde ? r.fecha_desde : desde;
      const fin = r.fecha_hasta < hasta ? r.fecha_hasta : hasta;
      if (ini >= fin) continue;
      const diff = Math.round((new Date(fin).getTime() - new Date(ini).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (diff <= 0) continue;
      vacPorEmp.set(r.empleado_id, (vacPorEmp.get(r.empleado_id) ?? 0) + diff);
    }

    const empleados = (empQ.data ?? []).map((e: Record<string, unknown>) => {
      const id = e.id as string;
      const a = asigPorEmp.get(id) ?? { horas: 0, costo: 0 };
      const fichHs = fichPorEmp.get(id) ?? 0;
      const vacDias = vacPorEmp.get(id) ?? 0;
      const salarioBase = num(e.salario_base);
      // Total devengado = salario base + costo horas en obras (que cubre horas extras imputadas)
      const totalDevengado = salarioBase + a.costo;
      return {
        id,
        nombre: e.nombre as string,
        cargo: (e.cargo as string) ?? null,
        salario_base: salarioBase,
        horas_obras: a.horas,
        costo_horas_obras: a.costo,
        horas_fichaje: fichHs,
        dias_vacaciones: vacDias,
        total_devengado: totalDevengado,
      };
    });

    const totales = empleados.reduce(
      (acc, e) => ({
        salario_base: acc.salario_base + e.salario_base,
        costo_horas_obras: acc.costo_horas_obras + e.costo_horas_obras,
        total_devengado: acc.total_devengado + e.total_devengado,
        horas_obras: acc.horas_obras + e.horas_obras,
        horas_fichaje: acc.horas_fichaje + e.horas_fichaje,
        dias_vacaciones: acc.dias_vacaciones + e.dias_vacaciones,
      }),
      { salario_base: 0, costo_horas_obras: 0, total_devengado: 0, horas_obras: 0, horas_fichaje: 0, dias_vacaciones: 0 }
    );

    return NextResponse.json(successResponse({ mes, empleados, totales }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
