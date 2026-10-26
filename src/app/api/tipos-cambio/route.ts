import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { isAdmin } from "@/lib/middleware/auth";

/**
 * Tipos de cambio (punto 1.5, y base del punto 7).
 *
 * GET  /api/tipos-cambio  → la cotización vigente + el historial.
 * POST /api/tipos-cambio  → carga una cotización nueva.
 *
 * APPEND-ONLY, A PROPÓSITO
 *   No hay PATCH ni DELETE. Corregir una cotización es cargar otra, nunca
 *   editar la anterior: las compras que ya se cargaron usaron la vieja, y si
 *   se pudiera reescribir, el costo de todo lo comprado ese día cambiaría
 *   retroactivamente y los informes dejarían de coincidir con las facturas en
 *   papel. El punto 7.2 lo pide con estas palabras: "no sobrescribir
 *   cotizaciones históricas usadas en operaciones".
 *
 * COMPRADOR Y VENDEDOR
 *   Una compra al exterior se paga al tipo VENDEDOR (el banco te vende los
 *   dólares). Una venta cobrada en dólares se convierte al COMPRADOR.
 */

const MONEDA_DEFAULT = "USD";
const OFFSET_PY = "-03:00";

/** Mensaje único para cuando falta la migración, en los dos verbos. */
const FALTA_TABLA = "Falta correr 20_tipos_cambio.sql en la base.";
const esTablaFaltante = (msg: string) =>
  /tipos_cambio/.test(msg) && /(does not exist|schema cache|PGRST205)/i.test(msg);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const moneda = (sp.get("moneda") ?? MONEDA_DEFAULT).trim().toUpperCase();
    const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "30", 10) || 30));

    // Filtros del historial (punto 7.2). Paraguay es UTC−3 todo el año; el
    // offset va escrito porque la tzdata del server puede estar vieja.
    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const desde = reFecha.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = reFecha.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
    const usuario = (sp.get("usuario") ?? "").trim();

    let qb = ctx.supabase
      .from("tipos_cambio")
      .select("id, moneda, compra, venta, vigente_desde, usuario_nombre, observacion, created_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("moneda", moneda);

    // Una cotización con fecha futura todavía no rige: se guarda pero no se
    // aplica hasta que llegue su momento. El historial sí la puede mostrar.
    if (sp.get("incluir_futuras") !== "1") {
      qb = qb.lte("vigente_desde", new Date().toISOString());
    }
    if (desde) qb = qb.gte("vigente_desde", `${desde}T00:00:00${OFFSET_PY}`);
    if (hasta) qb = qb.lte("vigente_desde", `${hasta}T23:59:59.999${OFFSET_PY}`);
    if (usuario) {
      const t = usuario.replace(/[(),]/g, " ").trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      if (t) qb = qb.ilike("usuario_nombre", `%${t}%`);
    }

    const r = await qb.order("vigente_desde", { ascending: false }).limit(limit);

    if (r.error) {
      if (esTablaFaltante(r.error.message ?? "")) {
        // Sin la tabla, la pantalla de compras sigue andando: el campo queda
        // vacío y se tipea a mano, como antes.
        return NextResponse.json(successResponse({ vigente: null, historial: [], migrado: false }));
      }
      throw new Error(r.error.message);
    }

    const historial = (r.data ?? []) as Array<Record<string, unknown>>;
    // Con incluir_futuras la primera fila puede ser una cotización que todavía
    // no rige: la vigente es siempre la última que ya empezó.
    const ahora = new Date().toISOString();
    const vigente = historial.find((h) => String(h.vigente_desde ?? "") <= ahora) ?? null;
    return NextResponse.json(successResponse({
      vigente,
      historial,
      migrado: true,
    }));
  } catch (err) {
    console.error("[/api/tipos-cambio GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el tipo de cambio."),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    // La cotización define el costo de todo lo que se compre en dólares: no es
    // un dato que pueda cambiar cualquiera.
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede cargar el tipo de cambio."),
        { status: 403 }
      );
    }

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moneda = String(b.moneda ?? MONEDA_DEFAULT).trim().toUpperCase() || MONEDA_DEFAULT;
    const compra = Number(b.compra);
    const venta = Number(b.venta);
    const observacion =
      typeof b.observacion === "string" && b.observacion.trim()
        ? b.observacion.trim().slice(0, 200)
        : null;

    if (!Number.isFinite(compra) || compra <= 0 || !Number.isFinite(venta) || venta <= 0) {
      return NextResponse.json(
        errorResponse("Poné las dos cotizaciones, comprador y vendedor, mayores a cero."),
        { status: 400 }
      );
    }
    // El mismo chequeo que el CHECK de la base, pero con un mensaje que se
    // entiende: cargadas al revés, los costos de importación salen por debajo
    // de lo que realmente se pagó.
    if (venta < compra) {
      return NextResponse.json(
        errorResponse("El vendedor no puede ser menor que el comprador. ¿Están al revés?"),
        { status: 400 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const ins = await ctx.supabase
      .from("tipos_cambio")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        moneda,
        compra,
        venta,
        vigente_desde: new Date().toISOString(),
        usuario_id: firma.id,
        usuario_nombre: firma.nombre,
        observacion,
      })
      .select("id, moneda, compra, venta, vigente_desde, usuario_nombre, observacion")
      .single();

    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (esTablaFaltante(msg)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
      }
      throw new Error(msg);
    }

    return NextResponse.json(successResponse({ cotizacion: ins.data }));
  } catch (err) {
    console.error("[/api/tipos-cambio POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar el tipo de cambio."),
      { status: 500 }
    );
  }
}
