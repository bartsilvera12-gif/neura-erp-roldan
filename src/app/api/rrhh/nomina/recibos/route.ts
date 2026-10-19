import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Recibos de nómina — Paraguay (IPS 9% trabajador / 16.5% patronal).
 * GET  /api/rrhh/nomina/recibos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * POST /api/rrhh/nomina/recibos  { empleado_id, periodo_desde, periodo_hasta, ... }
 */

type ReciboBody = {
  empleado_id?: string;
  periodo_desde?: string;
  periodo_hasta?: string;
  total_dias?: number;
  dias_trabajados?: number;
  devengos?: Array<{
    concepto: string;
    cantidad?: number;
    importe_unitario?: number;
    importe_total?: number;
    es_salarial?: boolean;
  }>;
  deducciones?: Array<{
    tipo: "ips_trabajador" | "ips_patronal" | "prestamo" | "judicial" | "otro";
    concepto: string;
    base?: number;
    tipo_pct?: number;
    importe?: number;
  }>;
  observaciones?: string;
};

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const desde = url.searchParams.get("desde") ?? "";
    const hasta = url.searchParams.get("hasta") ?? "";
    let q = ctx.supabase
      .from("nomina_recibos")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("periodo_desde", { ascending: false });
    if (desde) q = q.gte("periodo_desde", desde);
    if (hasta) q = q.lte("periodo_hasta", hasta);
    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ recibos: data ?? [] }));
  } catch (err) {
    console.error("[/api/rrhh/nomina/recibos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al listar recibos"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as ReciboBody;
    const empleadoId = String(body.empleado_id ?? "").trim();
    if (!empleadoId) return NextResponse.json(errorResponse("empleado_id obligatorio"), { status: 400 });
    const periodoDesde = String(body.periodo_desde ?? "").trim();
    const periodoHasta = String(body.periodo_hasta ?? "").trim();
    if (!periodoDesde || !periodoHasta) {
      return NextResponse.json(errorResponse("periodo_desde y periodo_hasta obligatorios"), { status: 400 });
    }

    // Snapshots PARAGUAY: leer empresa (ruc, ips_patronal) + empleado (afiliacion_ips)
    const [empresaQ, empleadoQ] = await Promise.all([
      ctx.supabase
        .from("empresas")
        .select("nombre_empresa, ruc, ips_patronal, centro_trabajo_direccion")
        .eq("id", ctx.auth.empresa_id)
        .maybeSingle(),
      ctx.supabase
        .from("empleados")
        .select("nombre, documento, afiliacion_ips, categoria_ips, cargo, fecha_ingreso")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", empleadoId)
        .maybeSingle(),
    ]);
    if (empresaQ.error) return NextResponse.json(errorResponse(empresaQ.error.message), { status: 400 });
    if (empleadoQ.error) return NextResponse.json(errorResponse(empleadoQ.error.message), { status: 400 });
    if (!empleadoQ.data) return NextResponse.json(errorResponse("Empleado no encontrado"), { status: 404 });

    const empresa = (empresaQ.data ?? {}) as Record<string, unknown>;
    const empleado = empleadoQ.data as Record<string, unknown>;

    const devengos = Array.isArray(body.devengos) ? body.devengos : [];
    const deducciones = Array.isArray(body.deducciones) ? body.deducciones : [];

    const totalDevengado = devengos.reduce((acc, d) => acc + num(d.importe_total), 0);
    const totalDeducTrab = deducciones
      .filter((d) => d.tipo === "ips_trabajador" || d.tipo === "prestamo" || d.tipo === "judicial" || d.tipo === "otro")
      .reduce((acc, d) => acc + num(d.importe), 0);
    const aportePatronal = deducciones
      .filter((d) => d.tipo === "ips_patronal")
      .reduce((acc, d) => acc + num(d.importe), 0);
    const liquido = totalDevengado - totalDeducTrab;
    const costeEmpresa = totalDevengado + aportePatronal;

    const cabecera = {
      empresa_id: ctx.auth.empresa_id,
      empleado_id: empleadoId,
      periodo_desde: periodoDesde,
      periodo_hasta: periodoHasta,
      total_dias: Math.trunc(num(body.total_dias)) || 30,
      dias_trabajados: Math.trunc(num(body.dias_trabajados)) || 30,
      empresa_nombre_snapshot: (empresa.nombre_empresa as string) ?? null,
      empresa_ruc_snapshot: (empresa.ruc as string) ?? null,
      empresa_ips_patronal_snapshot: (empresa.ips_patronal as string) ?? null,
      empleado_nombre_snapshot: (empleado.nombre as string) ?? null,
      empleado_documento_snapshot: (empleado.documento as string) ?? null,
      empleado_afiliacion_ips_snapshot: (empleado.afiliacion_ips as string) ?? null,
      empleado_categoria_ips_snapshot: (empleado.categoria_ips as string) ?? null,
      empleado_cargo_snapshot: (empleado.cargo as string) ?? null,
      empleado_antiguedad_snapshot: (empleado.fecha_ingreso as string) ?? null,
      total_devengado: totalDevengado,
      total_deducciones: totalDeducTrab,
      liquido,
      aporte_patronal: aportePatronal,
      coste_empresa: costeEmpresa,
      moneda: "PYG",
      estado: "borrador",
      observaciones: body.observaciones ? String(body.observaciones).trim() || null : null,
    };

    const { data: rec, error: recErr } = await ctx.supabase
      .from("nomina_recibos").insert([cabecera]).select().single();
    if (recErr) return NextResponse.json(errorResponse(recErr.message), { status: 400 });

    const reciboId = (rec as { id: string }).id;

    if (devengos.length > 0) {
      const rows = devengos.map((d, i) => ({
        recibo_id: reciboId,
        empresa_id: ctx.auth.empresa_id,
        concepto: String(d.concepto ?? "").trim() || "Sin concepto",
        cantidad: num(d.cantidad) || null,
        importe_unitario: num(d.importe_unitario) || null,
        importe_total: num(d.importe_total),
        es_salarial: d.es_salarial !== false,
        orden: i,
      }));
      await ctx.supabase.from("nomina_recibo_devengos").insert(rows);
    }
    if (deducciones.length > 0) {
      const rows = deducciones.map((d, i) => ({
        recibo_id: reciboId,
        empresa_id: ctx.auth.empresa_id,
        tipo: d.tipo,
        concepto: String(d.concepto ?? "").trim() || "Sin concepto",
        base: num(d.base) || null,
        tipo_pct: num(d.tipo_pct) || null,
        importe: num(d.importe),
        orden: i,
      }));
      await ctx.supabase.from("nomina_recibo_deducciones").insert(rows);
    }

    return NextResponse.json(successResponse({ recibo: rec }));
  } catch (err) {
    console.error("[/api/rrhh/nomina/recibos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("Error al crear recibo"), { status: 500 });
  }
}
