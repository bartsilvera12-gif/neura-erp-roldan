import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

function calcHoras(entrada: string | null, salida: string | null): number {
  if (!entrada || !salida) return 0;
  const toMin = (hms: string) => {
    const [h, m] = hms.split(":").map((v) => parseInt(v, 10) || 0);
    return h * 60 + m;
  };
  const diff = toMin(salida) - toMin(entrada);
  return diff > 0 ? Math.round((diff / 60) * 100) / 100 : 0;
}

/**
 * GET /api/rrhh/fichajes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Lista fichajes en el rango (por defecto últimos 30 días) con datos del empleado.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const hoy = new Date();
    const desdeDefault = new Date(hoy);
    desdeDefault.setDate(hoy.getDate() - 30);
    const desde = sp.get("desde") ?? desdeDefault.toISOString().slice(0, 10);
    const hasta = sp.get("hasta") ?? hoy.toISOString().slice(0, 10);

    const { data, error } = await ctx.supabase
      .from("empleado_fichajes")
      .select("id, empleado_id, fecha, hora_entrada, hora_salida, horas, observacion, entrada_lat, entrada_lng, salida_lat, salida_lng, marcado_kiosco, empleados:empleado_id(nombre, cargo)")
      .eq("empresa_id", ctx.auth.empresa_id)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const fichajes = (data ?? []).map((row: Record<string, unknown>) => {
      const emp = row.empleados as { nombre?: string; cargo?: string | null } | { nombre?: string; cargo?: string | null }[] | null;
      const e = Array.isArray(emp) ? emp[0] : emp;
      return { ...row, empleado_nombre: e?.nombre ?? null, empleado_cargo: e?.cargo ?? null, empleados: undefined };
    });

    return NextResponse.json(successResponse({ fichajes, desde, hasta }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/rrhh/fichajes
 * Body: { empleado_id, fecha, hora_entrada?, hora_salida?, observacion? }
 * UPSERT por (empleado_id, fecha): si ya hay un fichaje del día, lo actualiza.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const empleadoId = String(body.empleado_id ?? "").trim();
    const fecha = String(body.fecha ?? "").trim();
    if (!empleadoId) return NextResponse.json(errorResponse("Falta empleado_id"), { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json(errorResponse("fecha inválida (YYYY-MM-DD)"), { status: 400 });

    const horaEntrada = body.hora_entrada ? String(body.hora_entrada) : null;
    const horaSalida = body.hora_salida ? String(body.hora_salida) : null;
    const horas = calcHoras(horaEntrada, horaSalida);

    // Upsert por (empleado_id, fecha): primero busco, después actualizo o inserto.
    const existing = await ctx.supabase
      .from("empleado_fichajes")
      .select("id")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("empleado_id", empleadoId)
      .eq("fecha", fecha)
      .maybeSingle();

    if (existing.error) return NextResponse.json(errorResponse(existing.error.message), { status: 400 });

    if (existing.data?.id) {
      const upd = await ctx.supabase
        .from("empleado_fichajes")
        .update({
          hora_entrada: horaEntrada,
          hora_salida: horaSalida,
          horas,
          observacion: body.observacion ? String(body.observacion).trim() : null,
        })
        .eq("id", existing.data.id)
        .eq("empresa_id", ctx.auth.empresa_id);
      if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });
    } else {
      const ins = await ctx.supabase
        .from("empleado_fichajes")
        .insert([{
          empresa_id: ctx.auth.empresa_id,
          empleado_id: empleadoId,
          fecha,
          hora_entrada: horaEntrada,
          hora_salida: horaSalida,
          horas,
          observacion: body.observacion ? String(body.observacion).trim() : null,
        }]);
      if (ins.error) return NextResponse.json(errorResponse(ins.error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ ok: true, horas }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
