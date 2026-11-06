import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { DIAS_MES, rangoMes, reciboInicial } from "@/lib/rrhh/nomina-py";
import { diasAusenciaEnMes, diasPagablesMes, type AusenciaSimple } from "@/lib/rrhh/aguinaldo-py";
import { baseIps, baseDelPeriodo } from "@/lib/rrhh/ips";

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

/**
 * Los empleados del recibo.
 *
 * Las columnas del IPS las agrega el script 77. Mientras no se haya corrido,
 * PostgREST rechaza la consulta ENTERA con 42703 —no devuelve la fila sin la
 * columna— y no se generaría ningún recibo. Por eso se reintenta sin ellas: es
 * preferible un recibo que aporta sobre el salario real, que es como venía
 * funcionando, a que la liquidación del mes no salga.
 *
 * El `select` de supabase-js se tipa desde el LITERAL, así que no puede salir
 * de una variable: van las dos consultas escritas enteras.
 */
type Supa = Awaited<ReturnType<typeof getTenantSupabaseFromAuth>> extends infer C
  ? C extends { supabase: infer S } ? S : never
  : never;

async function traerEmpleados(supabase: Supa, empresaId: string, ids: string[]) {
  const con = await supabase
    .from("empleados")
    .select("id, nombre, documento, afiliacion_ips, categoria_ips, cargo, fecha_ingreso, fecha_ingreso_ips, salario_base, salario_ips, ips_sobre_minimo, tipo_periodo")
    .eq("empresa_id", empresaId)
    .in("id", ids);
  if (!con.error || !/ips|42703|does not exist/i.test(con.error.message ?? "")) return con;

  return supabase
    .from("empleados")
    .select("id, nombre, documento, afiliacion_ips, categoria_ips, cargo, fecha_ingreso, salario_base, tipo_periodo")
    .eq("empresa_id", empresaId)
    .in("id", ids);
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

    const [empresaQ, empleadosQ, existentesQ, ausQ, parametrosQ] = await Promise.all([
      ctx.supabase.from("empresas").select("nombre_empresa, ruc, ips_patronal").eq("id", empresaId).maybeSingle(),
      traerEmpleados(ctx.supabase, empresaId, ids),
      ctx.supabase
        .from("nomina_recibos")
        .select("empleado_id")
        .eq("empresa_id", empresaId)
        .gte("periodo_desde", desde)
        .lte("periodo_desde", hasta),
      // Reposos, permisos y demás del mes: esos días no se pagan.
      ctx.supabase
        .from("empleado_ausencias")
        .select("empleado_id, fecha_desde, fecha_hasta, tipo")
        .eq("empresa_id", empresaId)
        .in("empleado_id", ids)
        .lte("fecha_desde", hasta)
        .gte("fecha_hasta", desde),
      // El salario mínimo sale de un solo lugar: así, cuando sube por decreto,
      // se cambia una vez y todos los declarados sobre el mínimo quedan al día.
      ctx.supabase
        .from("rrhh_parametros")
        .select("salario_minimo")
        .eq("empresa_id", empresaId)
        .maybeSingle(),
    ]);

    const ausencias = new Map<string, AusenciaSimple[]>();
    for (const a of (ausQ.error ? [] : (ausQ.data ?? [])) as Array<AusenciaSimple & { empleado_id: string }>) {
      const l = ausencias.get(a.empleado_id) ?? [];
      l.push(a);
      ausencias.set(a.empleado_id, l);
    }
    if (empleadosQ.error) return NextResponse.json(errorResponse(empleadosQ.error.message), { status: 400 });
    if (existentesQ.error) return NextResponse.json(errorResponse(existentesQ.error.message), { status: 400 });
    const empresa = (empresaQ.data ?? {}) as Record<string, unknown>;
    // Si falta la tabla (script 77 sin correr) se sigue sin mínimo: el aporte
    // cae sobre el salario real, que es como funcionaba antes.
    const salarioMinimo = parametrosQ.error
      ? null
      : (parametrosQ.data as { salario_minimo?: number | null } | null)?.salario_minimo ?? null;
    const yaTienen = new Set(((existentesQ.data ?? []) as Array<{ empleado_id: string }>).map((r) => r.empleado_id));

    const creados: Array<{ id: string; empleado_id: string }> = [];
    const salteados: string[] = [];
    const errores: string[] = [];

    for (const e of (empleadosQ.data ?? []) as Array<Record<string, unknown>>) {
      const empleadoId = String(e.id);
      if (yaTienen.has(empleadoId)) { salteados.push(String(e.nombre ?? "")); continue; }

      /**
       * Los días que se pagan: los del mes, menos reposos, permisos y demás
       * ausencias cargadas, y menos los días antes del ingreso o después de
       * la baja. Así el recibo es el salario REAL, que es lo que después
       * suma para el aguinaldo. Las vacaciones no restan: son pagas.
       */
      const diasAus = diasAusenciaEnMes(ausencias.get(empleadoId) ?? [], mes);
      const diasPago = Math.min(
        diasTrabajados,
        diasPagablesMes(
          mes,
          e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : null,
          e.fecha_baja ? String(e.fecha_baja).slice(0, 10) : null,
          diasAus
        )
      );

      // De qué salario sale el 9%: el real, el declarado a mano, o el mínimo.
      const ips = baseIps(
        {
          salario_base: Number(e.salario_base) || 0,
          salario_ips: e.salario_ips == null ? null : Number(e.salario_ips),
          ips_sobre_minimo: e.ips_sobre_minimo === true,
        },
        salarioMinimo
      );
      // Se prorratea por los días que SE PAGAN, no por los 30 del mes: si no
      // se trabajó el mes entero, al IPS tampoco se le declara entero.
      const baseDeclarada = ips.origen === "real" || ips.origen === "sin_minimo_cargado"
        ? null
        : baseDelPeriodo(ips.base, diasPago, DIAS_MES);

      const { ingresos, descuentos, totales } = reciboInicial(
        Number(e.salario_base) || 0,
        diasPago,
        (e.tipo_periodo as string | null) ?? null,
        baseDeclarada
      );

      const cabecera = {
        empresa_id: empresaId,
        empleado_id: empleadoId,
        periodo_desde: desde,
        periodo_hasta: hasta,
        total_dias: DIAS_MES,
        dias_trabajados: diasPago,
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
