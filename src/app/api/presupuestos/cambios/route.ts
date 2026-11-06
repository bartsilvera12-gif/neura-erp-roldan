import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Los avisos de presupuestos que se cambiaron en la caja.
 *
 * ── A QUIÉN LE LLEGAN ──────────────────────────────────────────────────────
 *   A la vendedora que armó el presupuesto. Cobrar no se lo transfiere a quien
 *   cobró: el aviso sale de `vendedor_usuario_id`, que es de ella.
 *
 *   El admin ve todos, porque es el que atiende el reclamo cuando el cliente
 *   llama.
 *
 * GET  /api/presupuestos/cambios?sin_ver=1  → los avisos y cuántos sin ver
 * POST /api/presupuestos/cambios            → marcar visto: { id } | { todos: true }
 */

/** `vendedor_usuario_id` y `usuario_id` guardan el id de auth, no `usuarios.id`. */
const ids = (auth: { usuarioCatalogId?: string | null; user?: { id?: string } | null }): string[] =>
  Array.from(
    new Set([auth.usuarioCatalogId, auth.user?.id].filter((v): v is string => !!v))
  );

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = request.nextUrl.searchParams;
    const soloSinVer = sp.get("sin_ver") === "1";
    const esAdmin = isAdmin(ctx.auth);
    const mios = ids(ctx.auth);

    let q = ctx.supabase
      .from("presupuesto_cambios")
      .select(
        "id, presupuesto_id, presupuesto_numero, venta_id, venta_numero, vendedor_usuario_id, " +
          "vendedor_nombre, cobrado_por_nombre, cambios, total_presupuesto, total_cobrado, created_at, visto_at"
      )
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!esAdmin) {
      // Sin id propio no se le muestra nada: es más sano que mostrarle los
      // avisos de otra.
      if (mios.length === 0) return NextResponse.json(successResponse({ cambios: [], sin_ver: 0 }));
      q = q.in("vendedor_usuario_id", mios);
    }
    if (soloSinVer) q = q.is("visto_at", null);

    const { data, error } = await q;
    // Sin el script 79 la tabla no existe: cero avisos, no un error en la
    // pantalla.
    if (error) return NextResponse.json(successResponse({ cambios: [], sin_ver: 0, falta_script: true }));

    const cambios = (data ?? []) as unknown as Record<string, unknown>[];
    return NextResponse.json(
      successResponse({
        cambios,
        sin_ver: cambios.filter((c) => c.visto_at == null).length,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudieron leer los avisos.";
    console.error("[/api/presupuestos/cambios GET]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * Marcar visto.
 *
 * Solo la dueña del aviso lo marca visto. Acá el admin NO manda, aunque los
 * vea todos: si el admin —o el que cobró— pudiera marcarlos, le alcanzaría con
 * abrir el presupuesto para que a la vendedora le desapareciera el aviso sin
 * haberlo leído nunca. Visto significa que lo vio ella.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
    const todos = body.todos === true;
    if (!id && !todos) {
      return NextResponse.json(errorResponse("Falta el aviso a marcar."), { status: 400 });
    }

    const mios = ids(ctx.auth);
    if (mios.length === 0) {
      return NextResponse.json(errorResponse(API_ERRORS.FORBIDDEN), { status: 403 });
    }

    let q = ctx.supabase
      .from("presupuesto_cambios")
      .update({ visto_at: new Date().toISOString() })
      .eq("empresa_id", ctx.auth.empresa_id)
      .is("visto_at", null)
      .in("vendedor_usuario_id", mios);
    if (id) q = q.eq("id", id);

    const { error } = await q;
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo marcar el aviso.";
    console.error("[/api/presupuestos/cambios POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
