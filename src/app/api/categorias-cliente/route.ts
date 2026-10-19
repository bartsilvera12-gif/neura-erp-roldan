import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** GET /api/categorias-cliente — todas las categorías (activas + inactivas) de la empresa. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const soloActivas = (new URL(request.url).searchParams.get("solo_activas") ?? "") === "1";
    let q = ctx.supabase
      .from("categorias_cliente")
      .select("id, nombre, orden, activa")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("orden")
      .order("nombre");
    if (soloActivas) q = q.eq("activa", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ categorias: data ?? [] }));
  } catch (err) {
    console.error("[/api/categorias-cliente GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las categorías."), { status: 500 });
  }
}

/** POST /api/categorias-cliente — alta. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown; orden?: unknown };
    const nombre = String(body.nombre ?? "").trim();
    const orden = Number(body.orden ?? 0) || 0;
    if (!nombre) return NextResponse.json(errorResponse("Nombre obligatorio."), { status: 400 });
    const { data, error } = await ctx.supabase
      .from("categorias_cliente")
      .insert({ empresa_id: ctx.auth.empresa_id, nombre, orden, activa: true })
      .select("id, nombre, orden, activa")
      .maybeSingle();
    if (error) {
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Ya existe una categoría con ese nombre."), { status: 409 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ categoria: data }));
  } catch (err) {
    console.error("[/api/categorias-cliente POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
  }
}
