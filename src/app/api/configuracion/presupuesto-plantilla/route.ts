import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { PLANTILLA_POR_DEFECTO } from "@/lib/presupuestos/plantilla";

const FALTA_TABLA =
  "Falta correr 44_plantilla_presupuesto.sql para editar los textos del presupuesto.";

function faltaTabla(msg: string): boolean {
  return /presupuesto_plantilla/.test(msg) && /does not exist|42P01|schema cache/i.test(msg);
}

/**
 * GET  → los textos fijos del presupuesto impreso.
 * PUT  → los guarda. Solo un administrador.
 *
 * Son las condiciones que salen en el papel que recibe el cliente: plazos,
 * tolerancias, a qué cuenta se transfiere. Cambiarlas es una decisión
 * comercial, no algo que deba poder tocar cualquiera desde la pantalla.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const r = await ctx.supabase
      .from("presupuesto_plantilla")
      .select("forma_pago, validez, observaciones, anticipo_pct, updated_at, updated_por")
      .eq("empresa_id", ctx.auth.empresa_id)
      .maybeSingle();

    if (r.error) {
      // Sin la tabla se muestran los valores por defecto: el documento ya sale
      // con ellos, así que la pantalla tiene que mostrar lo mismo.
      if (faltaTabla(r.error.message)) {
        return NextResponse.json(successResponse({
          plantilla: PLANTILLA_POR_DEFECTO, editable: false, aviso: FALTA_TABLA,
        }));
      }
      throw new Error(r.error.message);
    }

    return NextResponse.json(successResponse({
      plantilla: r.data ?? PLANTILLA_POR_DEFECTO,
      editable: isAdmin(ctx.auth),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[/api/configuracion/presupuesto-plantilla GET]", msg);
    return NextResponse.json(errorResponse("No se pudieron cargar los textos."), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede cambiar los textos del presupuesto."),
        { status: 403 }
      );
    }

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const pct = Number(b.anticipo_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json(
        errorResponse("El anticipo tiene que estar entre 0 y 100."),
        { status: 400 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const r = await ctx.supabase.from("presupuesto_plantilla").upsert({
      empresa_id: ctx.auth.empresa_id,
      // Se recorta y no se rechaza: un texto largo de más es un error de pegado,
      // no un motivo para perder lo que la persona venía escribiendo.
      forma_pago: String(b.forma_pago ?? "").slice(0, 500),
      validez: String(b.validez ?? "").slice(0, 2000),
      observaciones: String(b.observaciones ?? "").slice(0, 8000),
      anticipo_pct: pct,
      updated_at: new Date().toISOString(),
      updated_por: firma.nombre,
    }, { onConflict: "empresa_id" });

    if (r.error) {
      if (faltaTabla(r.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 409 });
      }
      throw new Error(r.error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[/api/configuracion/presupuesto-plantilla PUT]", msg);
    return NextResponse.json(errorResponse("No se pudieron guardar los textos."), { status: 500 });
  }
}
