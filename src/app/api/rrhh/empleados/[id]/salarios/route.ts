import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { leerPermisosDeUsuario, puede } from "@/lib/rrhh/permisos";

/**
 * Historial salarial por empleado — Fase C.
 * GET: gate `salarios.ver` (admin, gestor, super_admin/admin legacy).
 * POST: gate `salarios.editar` (mismos + registra created_by).
 * Sin permiso → 403.
 */

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numn = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const jsonObj = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
};

async function gate(request: NextRequest, accion: "salarios.ver" | "salarios.editar") {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return { err: NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 }) } as const;
  const perms = await leerPermisosDeUsuario(ctx.supabase, ctx.auth.usuarioCatalogId ?? null, ctx.auth.user?.email ?? null);
  if (!puede(perms, accion)) {
    return { err: NextResponse.json(errorResponse("Sin permiso para acceder a salarios"), { status: 403 }) } as const;
  }
  return { ctx } as const;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "salarios.ver");
  if ("err" in g) return g.err;
  const { id } = await params;
  if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const { data, error } = await g.ctx.supabase
    .from("empleado_salarios")
    .select("*")
    .eq("empresa_id", g.ctx.auth.empresa_id)
    .eq("empleado_id", id)
    .order("fecha_vigencia_desde", { ascending: false });
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ salarios: data ?? [] }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "salarios.editar");
  if ("err" in g) return g.err;
  const { id } = await params;
  if (!id) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fecha_desde = String(body.fecha_vigencia_desde ?? "").trim();
  if (!fecha_desde) return NextResponse.json(errorResponse("fecha_vigencia_desde obligatoria"), { status: 400 });
  const fecha_hasta = body.fecha_vigencia_hasta ? String(body.fecha_vigencia_hasta) : null;

  const insert = {
    empresa_id: g.ctx.auth.empresa_id,
    empleado_id: id,
    fecha_vigencia_desde: fecha_desde,
    fecha_vigencia_hasta: fecha_hasta,
    salario_bruto: num(body.salario_bruto),
    salario_neto: numn(body.salario_neto),
    plus_peligrosidad: num(body.plus_peligrosidad),
    plus_prl: num(body.plus_prl),
    otros_pluses: jsonObj(body.otros_pluses),
    deducciones: jsonObj(body.deducciones),
    coste_empresa: numn(body.coste_empresa),
    moneda: (typeof body.moneda === "string" && body.moneda.trim()) || "PYG",
    observaciones: body.observaciones ? String(body.observaciones).trim() || null : null,
    created_by: g.ctx.auth.user?.id ?? null,
  };
  const { data, error } = await g.ctx.supabase
    .from("empleado_salarios")
    .insert([insert])
    .select()
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ salario: data }));
}
