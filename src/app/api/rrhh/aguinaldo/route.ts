import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { calcularAguinaldo, type AusenciaSimple } from "@/lib/rrhh/aguinaldo-py";

/**
 * GET /api/rrhh/aguinaldo?anio=2026&hasta_mes=12
 *
 * El aguinaldo de cada empleado: lo cobrado en el año ÷ 12, mes por mes.
 * Con recibo, el recibo (salario real). Sin recibo, el salario de la ficha
 * menos reposos, permisos y demás ausencias. Ver `src/lib/rrhh/aguinaldo-py.ts`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
    if (!puede(perms, "salarios.ver")) {
      return NextResponse.json(errorResponse("Sin permiso para ver salarios."), { status: 403 });
    }
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;
    const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
    const hastaMes = Math.max(1, Math.min(12, Number(sp.get("hasta_mes")) || 12));
    const ini = `${anio}-01-01`, fin = `${anio}-12-31`;

    let empQ = await ctx.supabase
      .from("empleados")
      .select("id, nombre, cargo, legajo, estado, salario_base, tipo_periodo, fecha_ingreso, fecha_baja")
      .eq("empresa_id", empresaId);
    if (empQ.error && /legajo/.test(empQ.error.message)) {
      // Sin el script 73 no hay código de empleado: se calcula igual.
      empQ = await ctx.supabase
        .from("empleados")
        .select("id, nombre, cargo, estado, salario_base, tipo_periodo, fecha_ingreso, fecha_baja")
        .eq("empresa_id", empresaId) as typeof empQ;
    }
    if (empQ.error) throw new Error(empQ.error.message);
    // Los que estuvieron en la empresa en algún momento del año.
    const empleados = ((empQ.data ?? []) as Array<Record<string, unknown>>).filter((e) => {
      const ing = e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : null;
      const baja = e.fecha_baja ? String(e.fecha_baja).slice(0, 10) : null;
      if (ing && ing > fin) return false;
      if (baja && baja < ini) return false;
      if (!baja && String(e.estado ?? "activo") !== "activo") return false;
      return true;
    });

    const [recibos, ausencias] = await Promise.all([
      traerTodas<Record<string, unknown>>((a, b) =>
        ctx.supabase.from("nomina_recibos")
          .select("id, empleado_id, periodo_desde, estado")
          .eq("empresa_id", empresaId).gte("periodo_desde", ini).lte("periodo_desde", fin)
          .order("id").range(a, b) as never),
      traerTodas<Record<string, unknown>>((a, b) =>
        ctx.supabase.from("empleado_ausencias")
          .select("empleado_id, fecha_desde, fecha_hasta, tipo")
          .eq("empresa_id", empresaId).lte("fecha_desde", fin).gte("fecha_hasta", ini)
          .order("id").range(a, b) as never).catch(() => []),
    ]);

    const vigentes = recibos.filter((r) => !/anulad/i.test(String(r.estado ?? "")));
    const imponible = new Map<string, number>();
    const ids = vigentes.map((r) => String(r.id));
    for (let i = 0; i < ids.length; i += 200) {
      const dq = await ctx.supabase
        .from("nomina_recibo_devengos")
        .select("recibo_id, importe_total, es_salarial")
        .eq("empresa_id", empresaId).in("recibo_id", ids.slice(i, i + 200));
      if (dq.error) throw new Error(dq.error.message);
      for (const d of (dq.data ?? []) as Array<{ recibo_id: string; importe_total: number; es_salarial: boolean | null }>) {
        if (d.es_salarial === false) continue;
        imponible.set(d.recibo_id, (imponible.get(d.recibo_id) ?? 0) + (Number(d.importe_total) || 0));
      }
    }

    const recibosPorEmpleado = new Map<string, Map<string, number>>();
    for (const r of vigentes) {
      const emp = String(r.empleado_id);
      const mes = String(r.periodo_desde).slice(0, 7);
      const m = recibosPorEmpleado.get(emp) ?? new Map<string, number>();
      m.set(mes, (m.get(mes) ?? 0) + (imponible.get(String(r.id)) ?? 0));
      recibosPorEmpleado.set(emp, m);
    }
    const ausPorEmpleado = new Map<string, AusenciaSimple[]>();
    for (const a of ausencias as Array<AusenciaSimple & { empleado_id: string }>) {
      const l = ausPorEmpleado.get(String(a.empleado_id)) ?? [];
      l.push({ fecha_desde: String(a.fecha_desde), fecha_hasta: String(a.fecha_hasta), tipo: String(a.tipo) });
      ausPorEmpleado.set(String(a.empleado_id), l);
    }

    const filas = empleados.map((e) => {
      const id = String(e.id);
      const r = calcularAguinaldo({
        anio,
        hastaMes,
        salarioBase: Number(e.salario_base) || 0,
        tipoPeriodo: (e.tipo_periodo as string | null) ?? null,
        ingreso: e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : null,
        baja: e.fecha_baja ? String(e.fecha_baja).slice(0, 10) : null,
        recibos: recibosPorEmpleado.get(id) ?? new Map(),
        ausencias: ausPorEmpleado.get(id) ?? [],
      });
      return {
        empleado_id: id,
        nombre: String(e.nombre ?? ""),
        cargo: e.cargo ? String(e.cargo) : null,
        codigo: e.legajo ? String(e.legajo) : null,
        tipo_periodo: (e.tipo_periodo as string | null) ?? "mensual",
        salario_base: Number(e.salario_base) || 0,
        ...r,
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return NextResponse.json(successResponse({ anio, hasta_mes: hastaMes, empleados: filas }));
  } catch (err) {
    console.error("[/api/rrhh/aguinaldo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular el aguinaldo."), { status: 500 });
  }
}
