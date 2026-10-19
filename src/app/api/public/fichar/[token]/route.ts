import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { successResponse, errorResponse } from "@/lib/api/response";

/**
 * Endpoints PÚBLICOS del kiosco de fichaje. NO requieren login.
 *
 *  GET  /api/public/fichar/[token]   → valida el token y devuelve datos
 *                                       minimos para mostrar el formulario.
 *  POST /api/public/fichar/[token]   → marca entrada o salida del empleado
 *                                       identificado por DNI (documento).
 *
 * Seguridad: el token de la URL identifica la empresa. Se valida antes de
 * cualquier escritura; si esta `activo=false`, devolvemos 404 (igual a token
 * inexistente) para no filtrar información.
 */

function hhmm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fechaLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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

async function resolveEmpresaIdFromToken(
  sb: ReturnType<typeof createServiceRoleClient>,
  token: string
): Promise<string | null> {
  const { data, error } = await sb
    .from("fichar_tokens")
    .select("empresa_id, activo")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.activo) return null;
  return (data as { empresa_id: string }).empresa_id;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json(errorResponse("Token requerido"), { status: 400 });

    const sb = createServiceRoleClient();
    const empresaId = await resolveEmpresaIdFromToken(sb, token);
    if (!empresaId) return NextResponse.json(errorResponse("Link inválido"), { status: 404 });

    const ahora = new Date();
    return NextResponse.json(successResponse({
      ok: true,
      hora_servidor: hhmm(ahora),
      fecha_servidor: fechaLocalISO(ahora),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json(errorResponse("Token requerido"), { status: 400 });

    const sb = createServiceRoleClient();
    const empresaId = await resolveEmpresaIdFromToken(sb, token);
    if (!empresaId) return NextResponse.json(errorResponse("Link inválido"), { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const documento = String(body.documento ?? "").trim();
    const tipo = String(body.tipo ?? "").trim();
    if (!documento) return NextResponse.json(errorResponse("Falta el documento"), { status: 400 });
    if (tipo !== "entrada" && tipo !== "salida") {
      return NextResponse.json(errorResponse("Tipo de marcado invalido"), { status: 400 });
    }
    const lat = body.lat != null && body.lat !== "" ? Number(body.lat) : null;
    const lng = body.lng != null && body.lng !== "" ? Number(body.lng) : null;

    // El cliente manda su fecha/hora local — el servidor suele estar en UTC
    // (Vercel) y `new Date().getHours()` daría 3-4 hs de mas. Validamos
    // formato; si llega vacío caemos al reloj del server (peor caso).
    const fechaCli = typeof body.fecha === "string" ? body.fecha.trim() : "";
    const horaCli  = typeof body.hora  === "string" ? body.hora.trim()  : "";
    const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaCli) ? fechaCli : null;
    const horaValida  = /^\d{2}:\d{2}$/.test(horaCli) ? horaCli : null;

    // Empleado activo de esa empresa cuyo documento coincida (case insensitive,
    // ignorando espacios y puntos para tolerar "12.345.678" vs "12345678").
    const norm = (s: string) => s.replace(/[\s.\-]/g, "").toLowerCase();
    const docNorm = norm(documento);

    const empQ = await sb
      .from("empleados")
      .select("id, nombre, documento, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true);
    if (empQ.error) return NextResponse.json(errorResponse(empQ.error.message), { status: 400 });

    const candidatos = (empQ.data ?? []) as Array<{ id: string; nombre: string; documento: string | null; activo: boolean }>;
    const empleado = candidatos.find((e) => e.documento && norm(e.documento) === docNorm);
    if (!empleado) {
      return NextResponse.json(errorResponse("Documento no encontrado. Pedile a RRHH que cargue tu DNI."), { status: 404 });
    }

    const ahora = new Date();
    const fecha = fechaValida ?? fechaLocalISO(ahora);
    const hora = horaValida ?? hhmm(ahora);

    // Upsert por (empleado_id, fecha).
    const existing = await sb
      .from("empleado_fichajes")
      .select("id, hora_entrada, hora_salida")
      .eq("empresa_id", empresaId)
      .eq("empleado_id", empleado.id)
      .eq("fecha", fecha)
      .maybeSingle();
    if (existing.error) return NextResponse.json(errorResponse(existing.error.message), { status: 400 });

    if (existing.data?.id) {
      const prev = existing.data as { id: string; hora_entrada: string | null; hora_salida: string | null };
      if (tipo === "entrada" && prev.hora_entrada) {
        return NextResponse.json(errorResponse(`Ya marcaste entrada hoy a las ${prev.hora_entrada}.`), { status: 409 });
      }
      if (tipo === "salida" && prev.hora_salida) {
        return NextResponse.json(errorResponse(`Ya marcaste salida hoy a las ${prev.hora_salida}.`), { status: 409 });
      }
      const nuevaEntrada = tipo === "entrada" ? hora : prev.hora_entrada;
      const nuevaSalida  = tipo === "salida"  ? hora : prev.hora_salida;
      const patch: Record<string, unknown> = {
        hora_entrada: nuevaEntrada,
        hora_salida: nuevaSalida,
        horas: calcHoras(nuevaEntrada, nuevaSalida),
        marcado_kiosco: true,
      };
      if (tipo === "entrada") {
        patch.entrada_lat = lat;
        patch.entrada_lng = lng;
        patch.entrada_marcado_at = ahora.toISOString();
      } else {
        patch.salida_lat = lat;
        patch.salida_lng = lng;
        patch.salida_marcado_at = ahora.toISOString();
      }
      const upd = await sb
        .from("empleado_fichajes")
        .update(patch)
        .eq("id", prev.id)
        .eq("empresa_id", empresaId);
      if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });
    } else {
      if (tipo === "salida") {
        return NextResponse.json(errorResponse("Todavia no marcaste entrada hoy."), { status: 409 });
      }
      const ins = await sb
        .from("empleado_fichajes")
        .insert([{
          empresa_id: empresaId,
          empleado_id: empleado.id,
          fecha,
          hora_entrada: hora,
          hora_salida: null,
          horas: 0,
          marcado_kiosco: true,
          entrada_lat: lat,
          entrada_lng: lng,
          entrada_marcado_at: ahora.toISOString(),
        }]);
      if (ins.error) return NextResponse.json(errorResponse(ins.error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({
      ok: true,
      nombre: empleado.nombre,
      tipo,
      hora,
      fecha,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
