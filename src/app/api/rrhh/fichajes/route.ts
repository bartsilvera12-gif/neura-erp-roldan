import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Minutos de tardanza de un fichaje, ya descontada la tolerancia.
 *
 * Devuelve `null` cuando no corresponde evaluarlo (el empleado no tiene
 * horario cargado, o no hay hora de entrada). `null` y `0` son distintos: uno
 * es "no se mide", el otro es "llegó en hora".
 */
function calcMinutosTarde(
  horaEntrada: string | null,
  horaPrevista: string | null | undefined,
  toleranciaMin: number
): number | null {
  if (!horaEntrada || !horaPrevista) return null;
  const aMinutos = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const real = aMinutos(horaEntrada);
  const previsto = aMinutos(horaPrevista);
  if (real == null || previsto == null) return null;
  const atraso = real - previsto - Math.max(0, toleranciaMin);
  return atraso > 0 ? atraso : 0;
}

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

    // `minutos_tarde` existe solo si se corrió 11_llegadas_tarde.sql. Pedirla sin
    // más dejaba la pantalla entera en error mientras ese script no estuviera
    // aplicado: una columna opcional no puede tumbar el control horario.
    const COLS_BASE =
      "id, empleado_id, fecha, hora_entrada, hora_salida, horas, observacion, " +
      "entrada_lat, entrada_lng, salida_lat, salida_lng, marcado_kiosco, " +
      "empleados:empleado_id(nombre, cargo)";

    const consultar = (cols: string) =>
      ctx.supabase
        .from("empleado_fichajes")
        .select(cols)
        .eq("empresa_id", ctx.auth.empresa_id)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });

    let r = await consultar(`${COLS_BASE}, minutos_tarde`);
    if (r.error && /minutos_tarde/.test(r.error.message)) {
      r = await consultar(COLS_BASE);
    }
    const { error } = r;
    const data = r.data as unknown as Record<string, unknown>[] | null;

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

    // Una salida anterior a la entrada no es un turno nocturno: es un error de
    // carga. Antes se guardaba igual y `calcHoras` devolvía 0, así que el
    // fichaje quedaba registrado con 0 h y nadie se enteraba.
    if (horaEntrada && horaSalida && horaSalida <= horaEntrada) {
      return NextResponse.json(
        errorResponse(
          `La salida (${horaSalida}) no puede ser anterior ni igual a la entrada (${horaEntrada}). ` +
          `Si el turno cruza la medianoche, cargá dos fichajes, uno por día.`,
        ),
        { status: 400 },
      );
    }

    const horas = calcHoras(horaEntrada, horaSalida);

    // Tardanza contra el horario del empleado. Se guarda calculada: si mañana
    // le cambian el horario, el historial tiene que seguir diciendo lo que
    // pasó aquel día.
    let minutosTarde: number | null = null;
    let soportaTardanza = true;
    {
      const empQ = await ctx.supabase
        .from("empleados")
        .select("hora_entrada_prevista, tolerancia_minutos")
        .eq("empresa_id", ctx.auth.empresa_id).eq("id", empleadoId)
        .maybeSingle();
      if (empQ.error && /hora_entrada_prevista|tolerancia_minutos/.test(empQ.error.message)) {
        // Falta 11_llegadas_tarde.sql: se ficha igual, sin medir tardanza.
        soportaTardanza = false;
      } else {
        const emp = empQ.data as { hora_entrada_prevista?: string | null; tolerancia_minutos?: number } | null;
        minutosTarde = calcMinutosTarde(
          horaEntrada,
          emp?.hora_entrada_prevista ?? null,
          Number(emp?.tolerancia_minutos) || 0
        );
      }
    }
    /** Campos de tardanza, vacíos si el schema todavía no los tiene. */
    const campoTardanza = soportaTardanza ? { minutos_tarde: minutosTarde } : {};

    // Upsert por (empleado_id, fecha): primero busco, después actualizo o inserto.
    const existing = await ctx.supabase
      .from("empleado_fichajes")
      .select("id, hora_entrada, hora_salida, horas")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("empleado_id", empleadoId)
      .eq("fecha", fecha)
      .maybeSingle();

    if (existing.error) return NextResponse.json(errorResponse(existing.error.message), { status: 400 });

    // Pisar un fichaje cargado es destructivo y no hay forma de deshacerlo
    // desde la UI, así que se pide confirmación explícita. Antes el upsert lo
    // reemplazaba en silencio: alcanzaba con equivocarse de fecha para borrar
    // las horas de un día real.
    const previo = existing.data as
      | { id: string; hora_entrada: string | null; hora_salida: string | null; horas: number | null }
      | null;
    const tienteDatos = !!(previo && (previo.hora_entrada || previo.hora_salida));
    if (tienteDatos && body.reemplazar !== true) {
      return NextResponse.json(
        {
          ...errorResponse(
            `Ya hay un fichaje de ese empleado para el ${fecha} ` +
            `(${previo!.hora_entrada ?? "—"} a ${previo!.hora_salida ?? "—"}, ${previo!.horas ?? 0} h). ` +
            `Confirmá para reemplazarlo.`,
          ),
          requiere_confirmacion: true,
          fichaje_existente: previo,
        },
        { status: 409 },
      );
    }

    if (existing.data?.id) {
      const upd = await ctx.supabase
        .from("empleado_fichajes")
        .update({
          hora_entrada: horaEntrada,
          hora_salida: horaSalida,
          horas,
          ...campoTardanza,
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
          ...campoTardanza,
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
