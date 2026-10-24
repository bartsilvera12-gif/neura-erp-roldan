import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/ventas/[id]/reclasificar-cobro — CJ-01.
 *
 * Una factura al contado prevista en efectivo que en la entrega se cobra por
 * transferencia. Cambia el medio REAL del cobro **sin tocar la factura**: el
 * total, los ítems y el número de comprobante quedan exactamente iguales.
 *
 * POR QUÉ ESTO NO ES "ANULAR Y REHACER"
 *   Anular y volver a cargar generaría un comprobante nuevo y un doble ingreso
 *   en el arqueo. Acá se cambia el medio y se deja el rastro: la plata entró,
 *   entró una sola vez, y entró por otra vía.
 *
 * REGLAS (acordadas con el cliente el 24-10-2026)
 *   · El cajero reclasifica solo, sin autorización.
 *   · El comprobante de la transferencia no es obligatorio.
 *   · Si el turno de caja YA CERRÓ hace falta autorización del admin, porque
 *     el arqueo de ese turno ya quedó firmado y el cambio lo altera.
 *
 * EFECTO EN EL ARQUEO
 *   El arqueo calcula los medios leyendo `ventas.metodo_pago`, así que con
 *   cambiar ese campo el efectivo esperado baja y la transferencia sube solos.
 *   No se escribe ningún movimiento de caja extra: eso sería el doble ingreso
 *   que el checklist pide evitar.
 */

const MEDIOS = ["efectivo", "transferencia", "tarjeta", "cheque"] as const;
type Medio = (typeof MEDIOS)[number];

const esMedio = (v: unknown): v is Medio =>
  (MEDIOS as readonly string[]).includes(String(v ?? ""));

function esAdmin(rol: string | null | undefined): boolean {
  const r = (rol ?? "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const { id: ventaId } = await context.params;
    const sb = ctx.supabase;

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const metodoNuevo = String(b.metodo_pago ?? "").trim().toLowerCase();
    const motivo = String(b.motivo ?? "").trim();
    const referencia = typeof b.referencia === "string" && b.referencia.trim() ? b.referencia.trim().slice(0, 120) : null;
    const entidadId = typeof b.entidad_bancaria_id === "string" && b.entidad_bancaria_id.trim() ? b.entidad_bancaria_id.trim() : null;
    const entidadNombre = typeof b.entidad_nombre === "string" && b.entidad_nombre.trim() ? b.entidad_nombre.trim().slice(0, 120) : null;

    if (!esMedio(metodoNuevo)) {
      return NextResponse.json(errorResponse("Elegí un medio de cobro válido."), { status: 400 });
    }
    // El motivo sí es obligatorio: sin él, la reclasificación no se puede
    // auditar y el cambio parece arbitrario cuando alguien lo revise.
    if (!motivo) {
      return NextResponse.json(errorResponse("Escribí el motivo del cambio."), { status: 400 });
    }

    // ── La venta ──────────────────────────────────────────────────────────
    const vQ = await sb
      .from("ventas")
      .select("id, numero_control, metodo_pago, total, estado, caja_id")
      .eq("empresa_id", empresaId).eq("id", ventaId)
      .maybeSingle();
    if (vQ.error) throw new Error(vQ.error.message);
    if (!vQ.data) return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
    const venta = vQ.data as Record<string, unknown>;

    const metodoAnterior = String(venta.metodo_pago ?? "efectivo");
    if (metodoAnterior === metodoNuevo) {
      return NextResponse.json(
        errorResponse(`El cobro ya está registrado como ${metodoNuevo}.`),
        { status: 400 }
      );
    }
    if (String(venta.estado ?? "") === "anulada") {
      return NextResponse.json(
        errorResponse("La venta está anulada: no se puede reclasificar su cobro."),
        { status: 409 }
      );
    }

    // ── ¿El turno sigue abierto? ──────────────────────────────────────────
    let cajaCerrada = false;
    const cajaId = venta.caja_id ? String(venta.caja_id) : null;
    if (cajaId) {
      const cQ = await sb
        .from("cajas").select("estado")
        .eq("empresa_id", empresaId).eq("id", cajaId)
        .maybeSingle();
      cajaCerrada = String((cQ.data as { estado?: string } | null)?.estado ?? "") === "cerrada";
    }

    // Con el turno cerrado, el arqueo ya quedó firmado: solo el admin puede
    // alterarlo, y queda registrado quién lo autorizó.
    const autorizadoPor = cajaCerrada
      ? (ctx.auth.nombre ?? ctx.auth.user?.email ?? "admin")
      : null;
    if (cajaCerrada && !esAdmin(ctx.auth.rol)) {
      return NextResponse.json(
        errorResponse(
          "El turno de caja de esta venta ya cerró. Solo un administrador puede reclasificar el cobro."
        ),
        { status: 403 }
      );
    }

    // ── 1) El medio nuevo en la venta ─────────────────────────────────────
    const upd = await sb
      .from("ventas")
      .update({ metodo_pago: metodoNuevo, updated_at: new Date().toISOString() })
      .eq("empresa_id", empresaId).eq("id", ventaId);
    if (upd.error) throw new Error(upd.error.message);

    // ── 2) El detalle de pago, si la venta lo tiene ───────────────────────
    //      Las ventas mixtas no se reclasifican por acá: tienen varios medios
    //      a la vez y habría que decidir cuál cambia.
    if (metodoAnterior !== "mixto") {
      const pd = await sb
        .from("ventas_pagos_detalle")
        .update({
          metodo_pago: metodoNuevo,
          entidad_bancaria_id: entidadId,
          entidad_nombre_snapshot: entidadNombre,
          referencia,
        })
        .eq("empresa_id", empresaId).eq("venta_id", ventaId);
      if (pd.error) {
        // No es fatal: no todas las ventas tienen detalle cargado.
        console.warn("[reclasificar-cobro] detalle de pago:", pd.error.message);
      }
    }

    // ── 3) El rastro ──────────────────────────────────────────────────────
    const ins = await sb
      .from("reclasificaciones_cobro")
      .insert({
        empresa_id: empresaId,
        venta_id: ventaId,
        venta_numero: venta.numero_control == null ? null : String(venta.numero_control),
        caja_id: cajaId,
        caja_cerrada: cajaCerrada,
        metodo_anterior: metodoAnterior,
        metodo_nuevo: metodoNuevo,
        monto: Number(venta.total) || 0,
        entidad_bancaria_id: entidadId,
        entidad_nombre: entidadNombre,
        referencia,
        motivo,
        usuario_id: ctx.auth.usuarioCatalogId ?? null,
        usuario_nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null,
        autorizado_por: autorizadoPor,
      })
      .select("id")
      .single();
    if (ins.error) {
      // El medio ya cambió: se revierte para no dejarlo sin rastro.
      await sb.from("ventas")
        .update({ metodo_pago: metodoAnterior })
        .eq("empresa_id", empresaId).eq("id", ventaId);
      throw new Error(ins.error.message);
    }

    return NextResponse.json(successResponse({
      ok: true,
      reclasificacion_id: String((ins.data as { id: string }).id),
      metodo_anterior: metodoAnterior,
      metodo_nuevo: metodoNuevo,
      caja_cerrada: cajaCerrada,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/ventas/[id]/reclasificar-cobro]", msg);
    if (/reclasificaciones_cobro/.test(msg) && /does not exist/.test(msg)) {
      return NextResponse.json(
        errorResponse("Falta correr 17_reclasificacion_cobro.sql en la base."),
        { status: 500 }
      );
    }
    return NextResponse.json(errorResponse("No se pudo cambiar el medio de cobro."), { status: 500 });
  }
}
