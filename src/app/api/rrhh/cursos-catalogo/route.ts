import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const slugify = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const TIPOS = ["curso","certificado","habilitacion","documento_legal"] as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { data, error } = await ctx.supabase
      .from("cursos_catalogo")
      .select("*")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ cursos: data ?? [] }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre) return NextResponse.json(errorResponse("nombre obligatorio"), { status: 400 });
    const tipo = String(body.tipo ?? "curso");
    if (!TIPOS.includes(tipo as typeof TIPOS[number])) return NextResponse.json(errorResponse("tipo inválido"), { status: 400 });
    const slug = String(body.slug ?? slugify(nombre)).trim();
    const insert = {
      empresa_id: ctx.auth.empresa_id,
      nombre,
      slug: slug || slugify(nombre),
      tipo,
      entidad_emisora_default: body.entidad_emisora_default ? String(body.entidad_emisora_default) : null,
      duracion_dias: body.duracion_dias !== undefined && body.duracion_dias !== null && body.duracion_dias !== ""
        ? Number(body.duracion_dias) : null,
      activo: body.activo === undefined ? true : Boolean(body.activo),
      orden: Number.isFinite(Number(body.orden)) ? Number(body.orden) : 0,
      created_by: ctx.auth.user?.id ?? null,
    };
    const { data, error } = await ctx.supabase.from("cursos_catalogo").insert([insert]).select().single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ curso: data }));
  } catch (err) {
    return NextResponse.json(errorResponse(err instanceof Error ? err.message : "Error"), { status: 500 });
  }
}
