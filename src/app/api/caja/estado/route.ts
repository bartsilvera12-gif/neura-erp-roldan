import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getEstadoCajas } from "@/lib/caja/server";
import { duenosDeCajas, puedeOperarCaja } from "@/lib/caja/responsables";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";

/**
 * GET /api/caja/estado
 *
 * Devuelve TODAS las cajas activas de la empresa (abiertas o en cierre/conteo)
 * con su resumen/arqueo en vivo. Soporta múltiples cajas (Caja 1, Caja 2, …).
 * Respuesta: { cajas: CajaResumen[] } (vacío si no hay ninguna activa).
 *
 * `caja`/`resumen` (singular, la primera abierta) se mantienen por compatibilidad.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const base = await getEstadoCajas(ctx.supabase, ctx.auth.empresa_id, ctx.auth.sucursal_id ?? null);
    // Script 105: quién puede operar cada caja y sus nombres, para la pantalla.
    const conRol = await getAuthWithRol(request);
    const esAdmin = !!conRol && isAdmin(conRol);
    const yo = ctx.auth.usuarioCatalogId ?? null;
    const duenos = await duenosDeCajas(ctx.supabase, ctx.auth.empresa_id, base.map((c) => c.caja.id));
    const ids = [...new Set([...duenos.values()].flatMap((d) => [d.abierta_por, ...(d.responsables ?? [])]).filter((x): x is string => !!x))];
    const nombre = new Map<string, string>();
    if (ids.length > 0) {
      const u = await ctx.supabase.from("usuarios").select("id, nombre, email").eq("empresa_id", ctx.auth.empresa_id).in("id", ids);
      if (!u.error) {
        for (const x of (u.data ?? []) as Array<{ id: string; nombre: string | null; email: string | null }>) {
          nombre.set(String(x.id), (x.nombre ?? "").trim() || x.email || "Usuario");
        }
      }
    }
    const cajas = base.map((c) => {
      const d = duenos.get(c.caja.id);
      const quienes = d?.responsables == null ? null : [...new Set([d.abierta_por, ...d.responsables].filter((x): x is string => !!x))];
      return {
        ...c,
        puede_operar: puedeOperarCaja(d, yo, esAdmin),
        abierta_por_nombre: d?.abierta_por ? nombre.get(d.abierta_por) ?? null : null,
        responsables_nombres: quienes ? quienes.map((id) => nombre.get(id) ?? "Usuario") : null,
      };
    });
    const primera = cajas.find((c) => c.caja.estado === "abierta") ?? cajas[0] ?? null;
    return NextResponse.json(
      successResponse({
        cajas,
        caja: primera ? primera.caja : null,
        resumen: primera ?? null,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el estado de caja.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
