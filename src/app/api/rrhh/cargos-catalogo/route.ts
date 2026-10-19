import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

function slugify(nombre: string, existentes: Set<string>): string {
  const base = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  let slug = base || "cargo";
  let n = 2;
  while (existentes.has(slug)) { slug = `${base}-${n++}`; }
  return slug;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const all = request.nextUrl.searchParams.get("all") === "1";
    let q = ctx.supabase
      .from("cargos_catalogo")
      .select("id, empresa_id, slug, nombre, activo, orden, es_sistema, created_at, updated_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("orden", { ascending: true });
    if (!all) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ cargos: data ?? [] }));
  } catch (err) {
    console.error("[/api/rrhh/cargos-catalogo GET]", err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre || nombre.length > 200) return NextResponse.json(errorResponse("nombre inválido"), { status: 400 });

    const { data: exist } = await ctx.supabase
      .from("cargos_catalogo").select("slug").eq("empresa_id", ctx.auth.empresa_id);
    const set = new Set<string>(((exist ?? []) as { slug: string }[]).map((e) => e.slug));
    const slug = slugify(nombre, set);
    const ordenRaw = body.orden;
    const orden = typeof ordenRaw === "number" && Number.isFinite(ordenRaw)
      ? Math.max(0, Math.min(32000, Math.trunc(ordenRaw))) : 999;

    const { data, error } = await ctx.supabase.from("cargos_catalogo").insert({
      empresa_id: ctx.auth.empresa_id, slug, nombre, activo: true, orden, es_sistema: false,
    }).select().single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ cargo: data }), { status: 201 });
  } catch (err) {
    console.error("[/api/rrhh/cargos-catalogo POST]", err);
    return NextResponse.json(errorResponse("Error"), { status: 500 });
  }
}
