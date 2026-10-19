import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const AMBITOS = ["nacional", "regional", "local"] as const;

function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const sp = new URL(request.url).searchParams;
  let q = ctx.supabase
    .from("feriados")
    .select("id, fecha, nombre, ambito")
    .eq("empresa_id", ctx.auth.empresa_id)
    .order("fecha", { ascending: true });
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  if (isDate(desde)) q = q.gte("fecha", desde);
  if (isDate(hasta)) q = q.lte("fecha", hasta);
  const { data, error } = await q;
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ feriados: data ?? [] }));
}

export async function POST(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isDate(body.fecha)) return NextResponse.json(errorResponse("Fecha inválida (formato yyyy-mm-dd)."), { status: 400 });
  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  if (!nombre) return NextResponse.json(errorResponse("Nombre requerido."), { status: 400 });
  const ambito = AMBITOS.includes(body.ambito as (typeof AMBITOS)[number])
    ? (body.ambito as string)
    : "nacional";
  const { data, error } = await ctx.supabase
    .from("feriados")
    .upsert(
      { empresa_id: ctx.auth.empresa_id, fecha: body.fecha, nombre, ambito, created_by: ctx.auth.usuarioCatalogId ?? null },
      { onConflict: "empresa_id,fecha" }
    )
    .select("id, fecha, nombre, ambito")
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ feriado: data }));
}

export async function DELETE(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json(errorResponse("id requerido"), { status: 400 });
  const { error } = await ctx.supabase
    .from("feriados")
    .delete()
    .eq("id", id)
    .eq("empresa_id", ctx.auth.empresa_id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
  return NextResponse.json(successResponse({ id }));
}
