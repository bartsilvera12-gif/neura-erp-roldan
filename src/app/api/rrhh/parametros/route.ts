import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET/PUT /api/rrhh/parametros — los números de RRHH que fija una ley.
 *
 * Hoy, el salario mínimo. Vive en un solo lugar y no copiado en cada ficha:
 * cuando sube por decreto se cambia una vez y todos los empleados declarados
 * "sobre el mínimo" quedan al día. Si estuviera copiado en cada ficha habría
 * que entrar empleado por empleado, y el que se olvidara quedaría declarando
 * por debajo del mínimo legal sin que nada lo avise.
 *
 * No viene con un valor puesto a propósito: es un número que cambia, y dejarlo
 * escrito en el código sería dejar escrito algo que mañana es falso.
 */

const FALTA_TABLA = "Falta correr 77_ips_del_empleado.sql en la base.";
const falta77 = (m: string) => /rrhh_parametros|42P01|does not exist|schema cache/i.test(m);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const r = await ctx.supabase
      .from("rrhh_parametros")
      .select("salario_minimo, minimo_vigente_desde, updated_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();

    if (r.error) {
      if (falta77(r.error.message)) {
        return NextResponse.json(successResponse({
          salario_minimo: null, minimo_vigente_desde: null, disponible: false, aviso: FALTA_TABLA,
        }));
      }
      throw new Error(r.error.message);
    }

    const d = (r.data ?? {}) as Record<string, unknown>;
    return NextResponse.json(successResponse({
      salario_minimo: d.salario_minimo == null ? null : Number(d.salario_minimo),
      minimo_vigente_desde: (d.minimo_vigente_desde as string) ?? null,
      updated_at: (d.updated_at as string) ?? null,
      disponible: true,
    }));
  } catch (err) {
    console.error("[/api/rrhh/parametros GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron leer los parámetros."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const crudo = body.salario_minimo;
    const n = crudo === null || crudo === "" ? null : Number(crudo);
    if (n != null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json(errorResponse("El salario mínimo tiene que ser un número."), { status: 400 });
    }
    const desde = typeof body.minimo_vigente_desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.minimo_vigente_desde)
      ? body.minimo_vigente_desde
      : null;

    const up = await ctx.supabase
      .from("rrhh_parametros")
      .upsert([{
        empresa_id: ctx.auth.empresa_id,
        salario_minimo: n == null ? null : Math.round(n),
        minimo_vigente_desde: desde,
        updated_by: ctx.auth.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }], { onConflict: "empresa_id" })
      .select("salario_minimo, minimo_vigente_desde")
      .maybeSingle();

    if (up.error) {
      if (falta77(up.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 503 });
      }
      throw new Error(up.error.message);
    }

    return NextResponse.json(successResponse({ ok: true, ...(up.data ?? {}) }));
  } catch (err) {
    console.error("[/api/rrhh/parametros PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar."), { status: 500 });
  }
}
