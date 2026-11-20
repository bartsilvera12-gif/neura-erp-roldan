import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/notificaciones/leer — { claves: string[] }
 *
 * Marca avisos de la campana como leídos para quien llama. Se llama al
 * entrar a un aviso (todos) o con «Marcar como leído» (administrador).
 * Un aviso de presupuesto cambiado además queda visto para su vendedora, que
 * es como ya funcionaban esos avisos.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as { claves?: unknown };
    const claves = Array.isArray(b.claves)
      ? [...new Set(b.claves.map((c) => String(c).slice(0, 200)).filter(Boolean))].slice(0, 200)
      : [];
    if (claves.length === 0) return NextResponse.json(errorResponse("Faltan los avisos."), { status: 400 });
    const usuarioId = ctx.auth.usuarioCatalogId ?? null;

    // Los cambios de presupuesto: visto en su tabla, si es de quien lo marca.
    const cambios = claves.filter((c) => c.startsWith("cambio:")).map((c) => c.slice(7));
    if (cambios.length > 0) {
      const mios = [...new Set([usuarioId, ctx.auth.user?.id].filter((v): v is string => !!v))];
      if (mios.length > 0) {
        await ctx.supabase.from("presupuesto_cambios").update({ visto_at: new Date().toISOString() })
          .eq("empresa_id", ctx.auth.empresa_id).in("id", cambios).in("vendedor_usuario_id", mios).is("visto_at", null);
      }
    }

    if (!usuarioId) return NextResponse.json(successResponse({ guardado: false }));
    const up = await ctx.supabase.from("notificaciones_leidas").upsert(
      claves.map((clave) => ({ empresa_id: ctx.auth.empresa_id, usuario_id: usuarioId, clave, leida_at: new Date().toISOString() })),
      { onConflict: "empresa_id,usuario_id,clave" }
    );
    // Sin el script 96: la pantalla lo recuerda en esa computadora.
    return NextResponse.json(successResponse({ guardado: !up.error }));
  } catch (err) {
    console.error("[/api/notificaciones/leer]", err instanceof Error ? err.message : err);
    return NextResponse.json(successResponse({ guardado: false }));
  }
}
