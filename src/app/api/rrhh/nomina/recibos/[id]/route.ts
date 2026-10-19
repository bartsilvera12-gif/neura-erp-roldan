import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numn = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const TIPOS_DEDUCCION = ["ips_trabajador","ips_patronal","prestamo","judicial","otro"] as const;
type TipoDed = typeof TIPOS_DEDUCCION[number];
const TIPOS_TRABAJADOR: TipoDed[] = ["ips_trabajador","prestamo","judicial","otro"];

/** GET /api/rrhh/nomina/recibos/[id] — cabecera + devengos + deducciones. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const [recQ, devQ, dedQ] = await Promise.all([
      ctx.supabase.from("nomina_recibos").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("id", id).maybeSingle(),
      ctx.supabase.from("nomina_recibo_devengos").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("recibo_id", id).order("orden", { ascending: true }),
      ctx.supabase.from("nomina_recibo_deducciones").select("*").eq("empresa_id", ctx.auth.empresa_id).eq("recibo_id", id).order("tipo", { ascending: true }).order("orden", { ascending: true }),
    ]);
    if (recQ.error) return NextResponse.json(errorResponse(recQ.error.message), { status: 400 });
    if (!recQ.data) return NextResponse.json(errorResponse("Recibo no encontrado"), { status: 404 });
    if (devQ.error) return NextResponse.json(errorResponse(devQ.error.message), { status: 400 });
    if (dedQ.error) return NextResponse.json(errorResponse(dedQ.error.message), { status: 400 });

    return NextResponse.json(successResponse({
      recibo: recQ.data,
      devengos: devQ.data ?? [],
      deducciones: dedQ.data ?? [],
    }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

/** PUT /api/rrhh/nomina/recibos/[id] — reemplaza cabecera + líneas (delete + insert). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const devengos = Array.isArray(body.devengos) ? (body.devengos as Array<Record<string, unknown>>) : [];
    const deducciones = Array.isArray(body.deducciones) ? (body.deducciones as Array<Record<string, unknown>>) : [];

    const totalDevengado = devengos.reduce((acc, d) => acc + num(d.importe_total), 0);
    const totalDeducTrab = deducciones
      .filter((d) => TIPOS_TRABAJADOR.includes(d.tipo as TipoDed))
      .reduce((acc, d) => acc + num(d.importe), 0);
    const aportePatronal = deducciones
      .filter((d) => d.tipo === "ips_patronal")
      .reduce((acc, d) => acc + num(d.importe), 0);
    const liquido = totalDevengado - totalDeducTrab;
    const costeEmpresa = totalDevengado + aportePatronal;

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      total_devengado: totalDevengado,
      total_deducciones: totalDeducTrab,
      liquido,
      aporte_patronal: aportePatronal,
      coste_empresa: costeEmpresa,
    };
    if (body.periodo_desde !== undefined) update.periodo_desde = String(body.periodo_desde);
    if (body.periodo_hasta !== undefined) update.periodo_hasta = String(body.periodo_hasta);
    if (body.total_dias !== undefined) update.total_dias = Math.trunc(num(body.total_dias)) || 30;
    if (body.dias_trabajados !== undefined) update.dias_trabajados = Math.trunc(num(body.dias_trabajados)) || 30;
    if (body.estado !== undefined) update.estado = String(body.estado);
    if (body.observaciones !== undefined) update.observaciones = body.observaciones ? String(body.observaciones) : null;

    const { error: upErr } = await ctx.supabase
      .from("nomina_recibos").update(update).eq("id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (upErr) return NextResponse.json(errorResponse(upErr.message), { status: 400 });

    const [delDev, delDed] = await Promise.all([
      ctx.supabase.from("nomina_recibo_devengos").delete().eq("recibo_id", id).eq("empresa_id", ctx.auth.empresa_id),
      ctx.supabase.from("nomina_recibo_deducciones").delete().eq("recibo_id", id).eq("empresa_id", ctx.auth.empresa_id),
    ]);
    if (delDev.error) return NextResponse.json(errorResponse(delDev.error.message), { status: 400 });
    if (delDed.error) return NextResponse.json(errorResponse(delDed.error.message), { status: 400 });

    if (devengos.length > 0) {
      const rows = devengos.map((d, i) => ({
        recibo_id: id, empresa_id: ctx.auth.empresa_id,
        concepto: String(d.concepto ?? "").trim() || "Concepto",
        cantidad: numn(d.cantidad), importe_unitario: numn(d.importe_unitario),
        importe_total: num(d.importe_total),
        es_salarial: d.es_salarial !== false,
        orden: typeof d.orden === "number" ? d.orden : i,
      }));
      const { error } = await ctx.supabase.from("nomina_recibo_devengos").insert(rows);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (deducciones.length > 0) {
      const rows = deducciones.map((d, i) => {
        const tipo = TIPOS_DEDUCCION.includes(d.tipo as TipoDed) ? d.tipo as TipoDed : "otro";
        return {
          recibo_id: id, empresa_id: ctx.auth.empresa_id,
          tipo, concepto: String(d.concepto ?? "").trim() || "Concepto",
          base: numn(d.base), tipo_pct: numn(d.tipo_pct),
          importe: num(d.importe),
          orden: typeof d.orden === "number" ? d.orden : i,
        };
      });
      const { error } = await ctx.supabase.from("nomina_recibo_deducciones").insert(rows);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const { error } = await ctx.supabase
      .from("nomina_recibos").delete().eq("id", id).eq("empresa_id", ctx.auth.empresa_id);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
