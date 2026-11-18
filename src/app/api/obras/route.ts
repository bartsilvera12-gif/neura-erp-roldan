import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { AVISO_89, faltaScript89 } from "@/lib/presupuestos/server/extras-89";

/**
 * GET  /api/obras?q=&cliente_id=  — busca obras por nombre o dirección.
 *      Con `cliente_id`, primero las de ese cliente.
 * POST /api/obras { nombre, direccion?, ciudad?, cliente_id? } — crea una obra.
 *
 * Las obras se crean una vez y después se eligen (script 89): escrita a mano
 * en cada presupuesto, la misma obra quedaba con tres nombres y no se
 * encontraba al buscar.
 */
export const dynamic = "force-dynamic";

type Obra = { id: string; nombre: string; direccion: string | null; ciudad: string | null; cliente_id: string | null };

function aObra(r: Record<string, unknown>): Obra {
  const t = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  return { id: String(r.id), nombre: String(r.nombre ?? ""), direccion: t(r.direccion), ciudad: t(r.ciudad), cliente_id: t(r.cliente_id) };
}

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  const clienteId = (sp.get("cliente_id") ?? "").trim();

  let qb = ctx.supabase
    .from("obras")
    .select("id, nombre, direccion, ciudad, cliente_id")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("activo", true)
    .order("nombre", { ascending: true })
    .limit(40);
  if (q) qb = qb.or(`nombre.ilike.%${q}%,direccion.ilike.%${q}%,ciudad.ilike.%${q}%`);
  else if (clienteId) qb = qb.eq("cliente_id", clienteId);

  const r = await qb;
  if (r.error) {
    if (faltaScript89(r.error.message)) {
      return NextResponse.json(successResponse({ obras: [], aviso: AVISO_89 }));
    }
    return NextResponse.json(errorResponse(r.error.message), { status: 500 });
  }
  const obras = ((r.data ?? []) as Record<string, unknown>[]).map(aObra);
  // Las del cliente elegido, primero.
  if (clienteId) obras.sort((a, b) => Number(b.cliente_id === clienteId) - Number(a.cliente_id === clienteId));
  return NextResponse.json(successResponse({ obras, aviso: null }));
}

export async function POST(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch {
    return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
  }
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const nombre = txt(body.nombre, 160);
  if (!nombre) return NextResponse.json(errorResponse("Poné el nombre de la obra."), { status: 400 });

  // Si ya existe con ese nombre, se devuelve esa en vez de duplicarla.
  const ya = await ctx.supabase
    .from("obras")
    .select("id, nombre, direccion, ciudad, cliente_id")
    .eq("empresa_id", ctx.auth.empresa_id)
    .ilike("nombre", nombre.replace(/[%_]/g, (c) => `\\${c}`))
    .limit(1);
  if (ya.error) {
    if (faltaScript89(ya.error.message)) return NextResponse.json(errorResponse(AVISO_89), { status: 503 });
    return NextResponse.json(errorResponse(ya.error.message), { status: 500 });
  }
  const existente = (ya.data ?? [])[0] as Record<string, unknown> | undefined;
  if (existente) return NextResponse.json(successResponse({ obra: aObra(existente), ya_existia: true }));

  const firma = await firmaUsuario(ctx.supabase, ctx.auth);
  const clienteId = txt(body.cliente_id, 64);
  const ins = await ctx.supabase
    .from("obras")
    .insert({
      empresa_id: ctx.auth.empresa_id,
      nombre,
      direccion: txt(body.direccion, 300) || null,
      ciudad: txt(body.ciudad, 120) || null,
      cliente_id: clienteId || null,
      created_por: firma.nombre ?? null,
    })
    .select("id, nombre, direccion, ciudad, cliente_id")
    .single();
  if (ins.error) {
    if (faltaScript89(ins.error.message)) return NextResponse.json(errorResponse(AVISO_89), { status: 503 });
    return NextResponse.json(errorResponse(ins.error.message), { status: 500 });
  }
  return NextResponse.json(successResponse({ obra: aObra(ins.data as Record<string, unknown>), ya_existia: false }));
}
