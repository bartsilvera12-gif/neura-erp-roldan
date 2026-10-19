import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const TIPOS = ["reposo", "vacaciones", "permiso", "baja", "otro"] as const;

function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const sp = new URL(request.url).searchParams;
  let q = ctx.supabase
    .from("empleado_ausencias")
    .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, observacion, empleados:empleado_id(nombre)")
    .eq("empresa_id", ctx.auth.empresa_id)
    .order("fecha_desde", { ascending: false });
  const empleadoId = sp.get("empleadoId");
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  if (empleadoId) q = q.eq("empleado_id", empleadoId);
  // Solapamiento: ausencia se muestra si su rango intersecta con [desde, hasta].
  if (isDate(hasta)) q = q.lte("fecha_desde", hasta);
  if (isDate(desde)) q = q.gte("fecha_hasta", desde);
  const { data, error } = await q;
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ ausencias: data ?? [] }));
}

export async function POST(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const empleadoId = typeof body.empleado_id === "string" ? body.empleado_id : "";
  if (!empleadoId) return NextResponse.json(errorResponse("empleado_id requerido"), { status: 400 });
  if (!isDate(body.fecha_desde) || !isDate(body.fecha_hasta)) {
    return NextResponse.json(errorResponse("Rango de fechas inválido."), { status: 400 });
  }
  if (String(body.fecha_hasta) < String(body.fecha_desde)) {
    return NextResponse.json(errorResponse("fecha_hasta no puede ser anterior a fecha_desde."), { status: 400 });
  }
  const tipo = TIPOS.includes(body.tipo as (typeof TIPOS)[number]) ? (body.tipo as string) : null;
  if (!tipo) return NextResponse.json(errorResponse(`tipo inválido, usar: ${TIPOS.join(", ")}`), { status: 400 });
  const observacion = typeof body.observacion === "string" && body.observacion.trim() ? body.observacion.trim() : null;
  const { data, error } = await ctx.supabase
    .from("empleado_ausencias")
    .insert({
      empresa_id: ctx.auth.empresa_id,
      empleado_id: empleadoId,
      fecha_desde: body.fecha_desde,
      fecha_hasta: body.fecha_hasta,
      tipo,
      observacion,
      created_by: ctx.auth.usuarioCatalogId ?? null,
    })
    .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, observacion")
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ ausencia: data }));
}

export async function DELETE(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json(errorResponse("id requerido"), { status: 400 });
  const { error } = await ctx.supabase
    .from("empleado_ausencias")
    .delete()
    .eq("id", id)
    .eq("empresa_id", ctx.auth.empresa_id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ id }));
}
