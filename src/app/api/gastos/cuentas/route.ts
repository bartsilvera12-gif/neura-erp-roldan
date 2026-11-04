import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/gastos/cuentas — las cuentas del plan a las que se puede imputar
 * un gasto.
 *
 * ── POR QUÉ NO SE USA /api/configuracion/plan-cuentas ──────────────────────
 *   Esa ruta es de administración del plan: exige permiso de Plan de Cuentas y
 *   devuelve el árbol entero con su resumen. Quien carga un gasto no tiene por
 *   qué poder editar el plan, y pedirle ese permiso para completar un campo
 *   obligaría a dárselo —que es exactamente al revés de lo que se quiere.
 *
 * ── SOLO LAS ASENTABLES ────────────────────────────────────────────────────
 *   Las cuentas de título (5 "EGRESOS", 5.2 "GASTOS OPERATIVOS") agrupan pero
 *   no reciben asientos: vienen con `asentable = false`. Ofrecerlas sería
 *   dejar que alguien impute a una cuenta que el contador va a tener que
 *   rehacer.
 *
 * ── NATURALEZA DEUDORA ─────────────────────────────────────────────────────
 *   Un gasto va al DEBE, así que solo se ofrecen cuentas con `naturaleza = D`.
 *   Imputar un gasto a una cuenta acreedora da un asiento al revés.
 *
 *   `?todas=1` levanta ese filtro, para el caso raro de un gasto que de verdad
 *   va contra otra cosa. Se pide a propósito: el default es el correcto.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const todas = new URL(request.url).searchParams.get("todas") === "1";

    let q = ctx.supabase
      .from("plan_cuentas")
      .select("id, cuenta, denominacion, naturaleza, asentable, activo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("asentable", true)
      .order("cuenta", { ascending: true });
    if (!todas) q = q.eq("naturaleza", "D");

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const filas = ((data ?? []) as Array<Record<string, unknown>>)
      // `activo` puede venir null en cuentas viejas: solo se descarta lo que
      // está explícitamente dado de baja.
      .filter((c) => c.activo !== false)
      .map((c) => ({
        id: String(c.id),
        cuenta: String(c.cuenta ?? ""),
        denominacion: String(c.denominacion ?? ""),
        // Lo que se ve en el desplegable: "5.2.03 · Alquileres".
        etiqueta: `${String(c.cuenta ?? "")} · ${String(c.denominacion ?? "")}`,
      }));

    return NextResponse.json(successResponse({
      cuentas: filas,
      /** Para poder avisar que el plan está vacío en vez de mostrar una lista muda. */
      hay_plan: filas.length > 0,
    }));
  } catch (err) {
    console.error("[/api/gastos/cuentas]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar las cuentas contables."),
      { status: 500 }
    );
  }
}
