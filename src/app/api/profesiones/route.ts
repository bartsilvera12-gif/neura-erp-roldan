import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const FALTA_TABLA = "Falta correr 47_profesiones.sql para usar el catálogo de profesiones.";

function faltaTabla(msg: string): boolean {
  return /profesiones/.test(msg) && /does not exist|42P01|schema cache/i.test(msg);
}

/**
 * Catálogo de profesiones u oficios del cliente.
 *
 * Mismo criterio que los rubros de cliente: una lista que se carga una vez,
 * para no terminar con el mismo oficio escrito de cinco formas distintas.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const soloActivas = (new URL(request.url).searchParams.get("solo_activas") ?? "") === "1";

    let q = ctx.supabase
      .from("profesiones")
      .select("id, nombre, orden, activa")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("orden")
      .order("nombre");
    if (soloActivas) q = q.eq("activa", true);
    const { data, error } = await q;

    if (error) {
      // Sin la tabla, las pantallas siguen andando con el campo de texto libre
      // de antes: es preferible a dejarlas sin cargar.
      if (faltaTabla(error.message)) {
        return NextResponse.json(successResponse({ profesiones: [], disponible: false, aviso: FALTA_TABLA }));
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ profesiones: data ?? [], disponible: true }));
  } catch (err) {
    console.error("[/api/profesiones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las profesiones."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown; orden?: unknown };
    // En mayúsculas como el resto de los catálogos: así "Albañil" y "ALBAÑIL"
    // no entran dos veces.
    const nombre = String(body.nombre ?? "").trim().toUpperCase();
    const orden = Number(body.orden ?? 0) || 0;
    if (!nombre) return NextResponse.json(errorResponse("Nombre obligatorio."), { status: 400 });

    const { data, error } = await ctx.supabase
      .from("profesiones")
      .insert({ empresa_id: ctx.auth.empresa_id, nombre, orden, activa: true })
      .select("id, nombre, orden, activa")
      .maybeSingle();
    if (error) {
      if (faltaTabla(error.message)) return NextResponse.json(errorResponse(FALTA_TABLA), { status: 409 });
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Esa profesión ya está en la lista."), { status: 409 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ profesion: data }));
  } catch (err) {
    console.error("[/api/profesiones POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la profesión."), { status: 500 });
  }
}
