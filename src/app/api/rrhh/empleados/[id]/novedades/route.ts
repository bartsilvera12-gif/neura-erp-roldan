import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede, type RrhhAccion } from "@/lib/rrhh/permisos";
import { AVISO_76, esTipoNovedad, faltaScript76 } from "@/lib/rrhh/novedades";

/**
 * Amonestaciones, observaciones y reconocimientos de un empleado (script 76).
 *
 * GET  — el historial, lo más nuevo primero (anuladas incluidas).
 * POST — registra una. Pide `empleados.editar`.
 */

const esFecha = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function gate(request: NextRequest, accion: RrhhAccion) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return { err: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) } as const;
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  if (!puede(perms, accion)) {
    return { err: NextResponse.json(errorResponse("No tenés permiso para esto."), { status: 403 }) } as const;
  }
  return { ctx } as const;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "empleados.ver");
  if ("err" in g) return g.err;
  const { id } = await params;
  const { data, error } = await g.ctx.supabase
    .from("empleado_novedades")
    .select("*")
    .eq("empresa_id", g.ctx.auth.empresa_id)
    .eq("empleado_id", id)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    if (faltaScript76(error.message)) return NextResponse.json(successResponse({ novedades: [], falta_script: AVISO_76 }));
    return NextResponse.json(errorResponse(error.message), { status: 400 });
  }
  return NextResponse.json(successResponse({ novedades: data ?? [] }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "empleados.editar");
  if ("err" in g) return g.err;
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (!esTipoNovedad(b.tipo)) return NextResponse.json(errorResponse("Elegí el tipo."), { status: 400 });
  const motivo = texto(b.motivo, 300);
  if (!motivo) return NextResponse.json(errorResponse("Escribí el motivo."), { status: 400 });
  const fecha = esFecha(b.fecha) ? String(b.fecha) : new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  let dias: number | null = null;
  let desde: string | null = null;
  if (b.tipo === "suspension") {
    dias = Math.trunc(Number(b.dias_suspension));
    if (!Number.isFinite(dias) || dias < 1 || dias > 30) {
      return NextResponse.json(errorResponse("Indicá cuántos días de suspensión (1 a 30)."), { status: 400 });
    }
    desde = esFecha(b.suspension_desde) ? String(b.suspension_desde) : null;
  }

  const emp = await g.ctx.supabase
    .from("empleados").select("id")
    .eq("empresa_id", g.ctx.auth.empresa_id).eq("id", id).maybeSingle();
  if (emp.error || !emp.data) return NextResponse.json(errorResponse("Empleado no encontrado."), { status: 404 });

  const auth = g.ctx.auth as { nombre?: string | null; user?: { id?: string; email?: string | null } | null };
  const { data, error } = await g.ctx.supabase
    .from("empleado_novedades")
    .insert([{
      empresa_id: g.ctx.auth.empresa_id,
      empleado_id: id,
      tipo: b.tipo,
      fecha,
      motivo,
      detalle: texto(b.detalle, 4000),
      dias_suspension: dias,
      suspension_desde: desde,
      created_by: auth.user?.id ?? null,
      created_by_nombre: (auth.nombre || auth.user?.email || null)?.slice(0, 120) ?? null,
    }])
    .select()
    .single();
  if (error) {
    if (faltaScript76(error.message)) return NextResponse.json(errorResponse(AVISO_76), { status: 503 });
    return NextResponse.json(errorResponse(error.message), { status: 400 });
  }
  return NextResponse.json(successResponse({ novedad: data }));
}
