import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { DIAS_MES, rangoMes, reciboInicial } from "@/lib/rrhh/nomina-py";

/**
 * Recibos de salario — Paraguay (IPS 9% trabajador / 16,5% patronal).
 *
 * GET  /api/rrhh/nomina/recibos?mes=YYYY-MM
 *      Antes la pantalla mandaba `mes` y acá se leían `desde`/`hasta`: el
 *      filtro no filtraba y en noviembre aparecían los recibos de octubre.
 *
 * POST /api/rrhh/nomina/recibos  { mes, empleado_ids: string[], dias_trabajados? }
 *      Genera los recibos del mes YA CARGADOS: salario del período (según los
 *      días trabajados) e IPS. Antes se creaban vacíos y había que entrar a
 *      cada uno a cargar todo a mano, sueldo incluido.
 *      Un empleado que ya tiene recibo ese mes se saltea: había dos recibos de
 *      la misma persona para octubre.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const mes = sp.get("mes") ?? "";
    let desde = sp.get("desde") ?? "";
    let hasta = sp.get("hasta") ?? "";
    if (/^\d{4}-\d{2}$/.test(mes)) ({ desde, hasta } = rangoMes(mes));

    let q = ctx.supabase
      .from("nomina_recibos")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("periodo_desde", { ascending: false });
    // Un recibo es del mes en que empieza su período.
    if (desde) q = q.gte("periodo_desde", desde);
    if (hasta) q = q.lte("periodo_desde", hasta);
    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    // El IPS del trabajador de cada recibo, para el total a depositar. No está
    // en la cabecera: `total_deducciones` mezcla IPS con anticipos y embargos.
    const recibos = (data ?? []) as Array<Record<string, unknown>>;
    const ipsPorRecibo = new Map<string, number>();
    const ids = recibos.map((r) => String(r.id));
    for (let i = 0; i < ids.length; i += 100) {
      const dq = await ctx.supabase
        .from("nomina_recibo_deducciones")
        .select("recibo_id, importe")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("tipo", "ips_trabajador")
        .in("recibo_id", ids.slice(i, i + 100));
      for (const d of (dq.data ?? []) as Array<{ recibo_id: string; importe: number }>) {
        ipsPorRecibo.set(d.recibo_id, (ipsPorRecibo.get(d.recibo_id) ?? 0) + (Number(d.importe) || 0));
      }
    }
    return NextResponse.json(successResponse({
      recibos: recibos.map((r) => ({ ...r, ips_trabajador: ipsPorRecibo.get(String(r.id)) ?? 0 })),
    }));
  } catch (err) {
    console.error("[/api/rrhh/nomina/recibos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al listar recibos"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mes = String(body.mes ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json(errorResponse("Elegí el mes."), { status: 400 });
    const ids = Array.isArray(body.empleado_ids)
      ? (body.empleado_ids as unknown[]).map((x) => String(x)).filter(Boolean)
      : body.empleado_id ? [String(body.empleado_id)] : [];
    if (ids.length === 0) return NextResponse.json(errorResponse("Elegí al menos un empleado."), { status: 400 });
    const diasTrabajados = Math.max(0, Math.min(DIAS_MES, Math.trunc(Number(body.dias_trabajados ?? DIAS_MES)) || DIAS_MES));
    const { desde, hasta } = rangoMes(mes);

    const [empresaQ, empleadosQ, existentesQ] = await Promise.all([
      ctx.supabase.from("empresas").select("nombre_empresa, ruc, ips_patronal").eq("id", empresaId).maybeSingle(),
      ctx.supabase
        .from("empleados")
        .select("id, nombre, documento, afiliacion_ips, categoria_ips, cargo, fecha_ingreso, salario_base, tipo_periodo")
        .eq("empresa_id", empresaId)
        .in("id", ids),
      ctx.supabase
        .from("nomina_recibos")
        .select("empleado_id")
        .eq("empresa_id", empresaId)
        .gte("periodo_desde", desde)
        .lte("periodo_desde", hasta),
    ]);
    if (empleadosQ.error) return NextResponse.json(errorResponse(empleadosQ.error.message), { status: 400 });
    if (existentesQ.error) return NextResponse.json(errorResponse(existentesQ.error.message), { status: 400 });
    const empresa = (empresaQ.data ?? {}) as Record<string, unknown>;
    const yaTienen = new Set(((existentesQ.data ?? []) as Array<{ empleado_id: string }>).map((r) => r.empleado_id));

    const creados: Array<{ id: string; empleado_id: string }> = [];
    const salteados: string[] = [];
    const errores: string[] = [];

    for (const e of (empleadosQ.data ?? []) as Array<Record<string, unknown>>) {
      const empleadoId = String(e.id);
      if (yaTienen.has(empleadoId)) { salteados.push(String(e.nombre ?? "")); continue; }

      const { ingresos, descuentos, totales } = reciboInicial(
        Number(e.salario_base) || 0,
        diasTrabajados,
        (e.tipo_periodo as string | null) ?? null
      );

      const cabecera = {
        empresa_id: empresaId,
        empleado_id: empleadoId,
        periodo_desde: desde,
        periodo_hasta: hasta,
        total_dias: DIAS_MES,
        dias_trabajados: diasTrabajados,
        empresa_nombre_snapshot: (empresa.nombre_empresa as string) ?? null,
        empresa_ruc_snapshot: (empresa.ruc as string) ?? null,
        empresa_ips_patronal_snapshot: (empresa.ips_patronal as string) ?? null,
        empleado_nombre_snapshot: (e.nombre as string) ?? null,
        empleado_documento_snapshot: (e.documento as string) ?? null,
        empleado_afiliacion_ips_snapshot: (e.afiliacion_ips as string) ?? null,
        empleado_categoria_ips_snapshot: (e.categoria_ips as string) ?? null,
        empleado_cargo_snapshot: (e.cargo as string) ?? null,
        empleado_antiguedad_snapshot: (e.fecha_ingreso as string) ?? null,
        total_devengado: totales.total_ingresos,
        total_deducciones: totales.total_descuentos,
        liquido: totales.neto,
        aporte_patronal: totales.aporte_patronal,
        coste_empresa: totales.costo_empresa,
        moneda: "PYG",
        estado: "borrador",
      };

      const { data: rec, error: recErr } = await ctx.supabase.from("nomina_recibos").insert([cabecera]).select("id").single();
      if (recErr || !rec) { errores.push(`${e.nombre}: ${recErr?.message ?? "sin respuesta"}`); continue; }
      const reciboId = (rec as { id: string }).id;

      if (ingresos.length > 0) {
        await ctx.supabase.from("nomina_recibo_devengos").insert(
          ingresos.map((d, i) => ({ recibo_id: reciboId, empresa_id: empresaId, ...d, orden: i }))
        );
      }
      if (descuentos.length > 0) {
        await ctx.supabase.from("nomina_recibo_deducciones").insert(
          descuentos.map((d, i) => ({ recibo_id: reciboId, empresa_id: empresaId, ...d, orden: i }))
        );
      }
      creados.push({ id: reciboId, empleado_id: empleadoId });
    }

    return NextResponse.json(successResponse({ creados, salteados, errores, recibo: creados[0] ?? null }));
  } catch (err) {
    console.error("[/api/rrhh/nomina/recibos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al generar recibos"), { status: 500 });
  }
}
