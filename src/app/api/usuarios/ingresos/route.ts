import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";

/**
 * GET /api/usuarios/ingresos — todos los ingresos al sistema, de todos los
 * usuarios: cuándo, quién, desde qué IP y qué equipo (pedido del cliente:
 * un reporte, en vez de entrar a cada usuario y bajar hasta el final).
 *
 * Filtros: ?usuario=<id>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&q=<ip o equipo>.
 * Solo administración. Hasta 2.000 filas, las más nuevas primero.
 */
export const dynamic = "force-dynamic";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuthWithRol(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  if (!isAdmin(ctx.auth)) {
    return NextResponse.json(errorResponse("Los ingresos los ve un administrador."), { status: 403 });
  }
  const sp = new URL(request.url).searchParams;
  const usuario = (sp.get("usuario") ?? "").trim();
  const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
  const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
  const q = (sp.get("q") ?? "").trim().replace(/[%,()]/g, "");

  let qb = ctx.supabase
    .from("usuario_ingresos")
    .select("id, created_at, usuario_id, usuario_nombre, dispositivo_id, dispositivo_nombre, sistema, navegador, ip, sucursal_id")
    .eq("empresa_id", ctx.auth.empresa_id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (usuario) qb = qb.eq("usuario_id", usuario);
  if (desde) qb = qb.gte("created_at", `${desde}T00:00:00-03:00`);
  if (hasta) qb = qb.lte("created_at", `${hasta}T23:59:59.999-03:00`);
  if (q) qb = qb.or(`ip.ilike.%${q}%,dispositivo_nombre.ilike.%${q}%,dispositivo_id.ilike.%${q}%`);

  const r = await qb;
  if (r.error) {
    if (/usuario_ingresos|does not exist|42P01|schema cache/i.test(r.error.message)) {
      return NextResponse.json(successResponse({ ingresos: [], usuarios: [], sucursales: {}, aviso: "Falta correr el script 92." }));
    }
    return NextResponse.json(errorResponse(r.error.message), { status: 500 });
  }

  const [uq, sq] = await Promise.all([
    ctx.supabase.from("usuarios").select("id, nombre, email").eq("empresa_id", ctx.auth.empresa_id).order("nombre"),
    ctx.supabase.from("sucursales").select("id, nombre").eq("empresa_id", ctx.auth.empresa_id),
  ]);
  const sucursales: Record<string, string> = {};
  for (const s of (sq.data ?? []) as Array<{ id: string; nombre: string }>) sucursales[s.id] = s.nombre;

  return NextResponse.json(successResponse({
    ingresos: r.data ?? [],
    usuarios: ((uq.data ?? []) as Array<{ id: string; nombre: string | null; email: string | null }>)
      .map((u) => ({ id: u.id, nombre: u.nombre || u.email || "—" })),
    sucursales,
    aviso: null,
  }));
}
