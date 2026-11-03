import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { TIPOS_EGRESO, esTipoEgresoValido } from "@/lib/caja/tipos-egreso";

/**
 * A qué cuenta del plan va cada clase de egreso de caja.
 *
 * GET → las clases con su cuenta (o null) y las cuentas elegibles.
 * PUT → guarda o borra la cuenta de una clase.
 *
 * ── POR QUÉ SOLO ADMIN PARA ESCRIBIR ─────────────────────────────────────
 * Imputar un egreso a otra cuenta mueve plata de un renglón del balance a
 * otro. Leerlo es inofensivo —la pantalla de caja lo muestra para que el
 * cajero sepa dónde cae lo que carga— pero decidirlo es del administrador.
 */
export const dynamic = "force-dynamic";

const FALTA_TABLA =
  "Falta correr 59_cuenta_contable_por_egreso.sql en la base.";

function esTablaFaltante(msg: string): boolean {
  return /caja_egreso_cuentas/.test(msg) && /does not exist|42P01|PGRST205|schema cache/i.test(msg);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    // Solo cuentas asentables: una cuenta agrupadora no recibe movimientos, y
    // ofrecerla lleva a elegirla y descubrirlo al cerrar el ejercicio.
    const cuentasQ = await ctx.supabase
      .from("plan_cuentas")
      .select("id, cuenta, denominacion, asentable, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("asentable", true)
      .order("cuenta");
    if (cuentasQ.error) throw new Error(cuentasQ.error.message);

    const mapaQ = await ctx.supabase
      .from("caja_egreso_cuentas")
      .select("tipo_egreso, cuenta_id")
      .eq("empresa_id", empresaId);
    if (mapaQ.error) {
      if (esTablaFaltante(mapaQ.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
      }
      throw new Error(mapaQ.error.message);
    }

    const porTipo = new Map<string, string>();
    for (const f of (mapaQ.data ?? []) as Array<{ tipo_egreso: string; cuenta_id: string }>) {
      porTipo.set(f.tipo_egreso, f.cuenta_id);
    }

    return NextResponse.json(successResponse({
      clases: TIPOS_EGRESO.map((t) => ({
        tipo_egreso: t.value,
        label: t.label,
        cuenta_id: porTipo.get(t.value) ?? null,
      })),
      cuentas: cuentasQ.data ?? [],
      sin_imputar: TIPOS_EGRESO.filter((t) => !porTipo.has(t.value)).length,
      puede_editar: isAdmin(ctx.auth),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (esTablaFaltante(msg)) {
      return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
    }
    console.error("[/api/configuracion/cuentas-egreso GET]", msg || err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar las cuentas de los egresos."),
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Elegir la cuenta de un egreso lo hace un administrador: mueve plata de un renglón del balance a otro."),
        { status: 403 }
      );
    }
    const empresaId = ctx.auth.empresa_id;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const tipo = String(b.tipo_egreso ?? "").trim();
    if (!esTipoEgresoValido(tipo)) {
      return NextResponse.json(errorResponse("Esa clase de egreso no existe."), { status: 400 });
    }

    const cuentaId = typeof b.cuenta_id === "string" ? b.cuenta_id.trim() : "";

    // Vacío = sacarle la cuenta a esa clase. Se borra la fila en vez de guardar
    // un null, para que "no tiene cuenta" sea una sola cosa y no dos.
    if (!cuentaId) {
      const del = await ctx.supabase
        .from("caja_egreso_cuentas")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("tipo_egreso", tipo);
      if (del.error) {
        if (esTablaFaltante(del.error.message)) {
          return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
        }
        throw new Error(del.error.message);
      }
      return NextResponse.json(successResponse({ ok: true, borrado: true }));
    }

    // La cuenta tiene que ser de esta empresa, activa y asentable: sin esto se
    // podría imputar a una cuenta de otro tenant pasando un uuid a mano.
    const cQ = await ctx.supabase
      .from("plan_cuentas")
      .select("id, asentable, activo")
      .eq("empresa_id", empresaId)
      .eq("id", cuentaId)
      .maybeSingle();
    if (cQ.error) throw new Error(cQ.error.message);
    const cuenta = cQ.data as { asentable?: boolean; activo?: boolean } | null;
    if (!cuenta) {
      return NextResponse.json(errorResponse("Esa cuenta no existe."), { status: 404 });
    }
    if (cuenta.activo === false || cuenta.asentable === false) {
      return NextResponse.json(
        errorResponse("Elegí una cuenta activa y asentable: las agrupadoras no reciben movimientos."),
        { status: 400 }
      );
    }

    const up = await ctx.supabase
      .from("caja_egreso_cuentas")
      .upsert(
        { empresa_id: empresaId, tipo_egreso: tipo, cuenta_id: cuentaId, updated_at: new Date().toISOString() },
        { onConflict: "empresa_id,tipo_egreso" }
      )
      .select("tipo_egreso, cuenta_id")
      .single();
    if (up.error) {
      if (esTablaFaltante(up.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 400 });
      }
      throw new Error(up.error.message);
    }

    return NextResponse.json(successResponse({ ok: true, imputacion: up.data }));
  } catch (err) {
    console.error("[/api/configuracion/cuentas-egreso PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar la cuenta del egreso."),
      { status: 500 }
    );
  }
}
