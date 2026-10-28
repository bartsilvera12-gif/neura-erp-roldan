import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** El error de PostgREST cuando falta `categorias_cliente.ajuste_pct` (script 39). */
function faltaScript39(msg: string): boolean {
  return /column .* does not exist|42703/i.test(msg) && /ajuste_pct/.test(msg);
}

/** El ajuste válido: NULL o un porcentaje que un humano pueda defender. */
function normalizarAjuste(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= -100 || n > 100) return null;
  return n;
}

/** GET /api/categorias-cliente — todos los rubros (activos + inactivos) de la empresa. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const soloActivas = (new URL(request.url).searchParams.get("solo_activas") ?? "") === "1";
    const armar = (cols: string) => {
      let q = ctx.supabase
        .from("categorias_cliente")
        .select(cols)
        .eq("empresa_id", ctx.auth.empresa_id)
        .order("orden")
        .order("nombre");
      if (soloActivas) q = q.eq("activa", true);
      return q;
    };
    // Sin el script 39 la columna no existe y PostgREST rechaza toda la
    // consulta, no devuelve null: se reintenta sin ella para que la pantalla
    // siga funcionando como antes.
    let r = await armar("id, nombre, orden, activa, ajuste_pct");
    let ajuste_disponible = true;
    if (r.error && faltaScript39(r.error.message ?? "")) {
      ajuste_disponible = false;
      r = await armar("id, nombre, orden, activa");
    }
    if (r.error) throw new Error(r.error.message);
    return NextResponse.json(successResponse({ categorias: r.data ?? [], ajuste_disponible }));
  } catch (err) {
    console.error("[/api/categorias-cliente GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los rubros."), { status: 500 });
  }
}

/** POST /api/categorias-cliente — alta. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown; orden?: unknown; ajuste_pct?: unknown };
    const nombre = String(body.nombre ?? "").trim();
    const orden = Number(body.orden ?? 0) || 0;
    const ajuste_pct = normalizarAjuste(body.ajuste_pct);
    if (!nombre) return NextResponse.json(errorResponse("Nombre obligatorio."), { status: 400 });

    const insertar = (fila: Record<string, unknown>, cols: string) =>
      ctx.supabase.from("categorias_cliente").insert(fila).select(cols).maybeSingle();
    const fila = { empresa_id: ctx.auth.empresa_id, nombre, orden, activa: true };
    let r = await insertar({ ...fila, ajuste_pct }, "id, nombre, orden, activa, ajuste_pct");
    if (r.error && faltaScript39(r.error.message ?? "")) {
      r = await insertar(fila, "id, nombre, orden, activa");
    }
    const { data, error } = r;
    if (error) {
      if (/23505|duplicate|unique/i.test(error.message)) {
        return NextResponse.json(errorResponse("Ya existe un rubro con ese nombre."), { status: 409 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json(successResponse({ categoria: data }));
  } catch (err) {
    console.error("[/api/categorias-cliente POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear el rubro."), { status: 500 });
  }
}
