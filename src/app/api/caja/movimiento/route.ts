import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarMovimiento, getCajaAbierta } from "@/lib/caja/server";
import { comprobantePathBelongsToEmpresa } from "@/lib/compras/comprobante-storage";
import { esTipoEgresoValido } from "@/lib/caja/tipos-egreso";

/**
 * POST /api/caja/movimiento
 *   Registra un movimiento manual en la caja abierta.
 *   Body: { tipo, concepto, monto, medio_pago?, observacion?, caja_id?, tipo_egreso? }
 *   Si caja_id no viene, se usa la caja abierta actual.
 */
const TIPOS_VALIDOS = ["ingreso", "egreso", "retiro", "ajuste"] as const;
const MEDIOS_VALIDOS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;

/** Tipos de papel que puede llevar un egreso. */
const TIPOS_ADJUNTO = new Set(["factura", "recibo"]);

/**
 * Deja pasar solo los adjuntos bien formados y de esta empresa.
 * Devuelve null si no queda ninguno, para no escribir un arreglo vacío.
 */
function adjuntosValidos(
  raw: unknown,
  empresaId: string
): Array<{ tipo: string; nombre: string; path: string | null; url: string | null }> | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const tipo = String(o.tipo ?? "");
    const path = typeof o.path === "string" ? o.path : "";
    if (!TIPOS_ADJUNTO.has(tipo)) return [];
    if (!comprobantePathBelongsToEmpresa(path, empresaId)) return [];
    return [{
      tipo,
      nombre: String(o.nombre ?? "comprobante").slice(0, 200),
      path,
      // La URL no se guarda: las firmadas vencen, y una vencida guardada en la
      // base se ve como un enlace roto. Se pide al abrir el comprobante.
      url: null,
    }];
  });
  return out.length > 0 ? out.slice(0, 2) : null;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const o = (body ?? {}) as Record<string, unknown>;

    const tipo = String(o.tipo ?? "");
    if (!(TIPOS_VALIDOS as readonly string[]).includes(tipo)) {
      return NextResponse.json(errorResponse("Tipo inválido."), { status: 400 });
    }
    const medioPago = String(o.medio_pago ?? "efectivo");
    if (!(MEDIOS_VALIDOS as readonly string[]).includes(medioPago)) {
      return NextResponse.json(errorResponse("Medio de pago inválido."), { status: 400 });
    }
    const concepto = String(o.concepto ?? "").trim();
    if (!concepto || concepto.length > 200) {
      return NextResponse.json(errorResponse("Concepto requerido (máx. 200 chars)."), { status: 400 });
    }
    const monto = Number(o.monto);
    if (!Number.isFinite(monto)) {
      return NextResponse.json(errorResponse("Monto inválido."), { status: 400 });
    }
    if (tipo !== "ajuste" && monto <= 0) {
      return NextResponse.json(
        errorResponse("El monto debe ser > 0 (solo ajustes pueden ser negativos)."),
        { status: 400 }
      );
    }
    const observacion =
      o.observacion == null || o.observacion === "" ? null : String(o.observacion).slice(0, 1000);

    const sucursalId = ctx.auth.sucursal_id ?? null;
    let cajaId = o.caja_id == null || o.caja_id === "" ? null : String(o.caja_id);
    if (!cajaId) {
      const abierta = await getCajaAbierta(ctx.supabase, ctx.auth.empresa_id, sucursalId);
      if (!abierta) {
        return NextResponse.json(
          errorResponse("No hay ninguna caja abierta."),
          { status: 409 }
        );
      }
      cajaId = abierta.id;
    }

    const movimiento = await registrarMovimiento(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      sucursalId,
      cajaId,
      tipo: tipo as (typeof TIPOS_VALIDOS)[number],
      concepto,
      monto,
      medioPago: medioPago as (typeof MEDIOS_VALIDOS)[number],
      observacion,
      // Punto 5.7. Solo aplica a egresos; en el resto se ignora.
      tipoEgreso: tipo === "egreso" && esTipoEgresoValido(o.tipo_egreso)
        ? o.tipo_egreso
        : null,
      // Punto 5.7: la factura y el recibo que respaldan el egreso. Se valida
      // que cada path sea de esta empresa antes de guardarlo: el navegador
      // manda el path que le devolvió la subida, y confiar en él permitiría
      // apuntar un egreso al comprobante de otro cliente.
      adjuntos: tipo === "egreso" ? adjuntosValidos(o.adjuntos, ctx.auth.empresa_id) : null,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioEmail: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ movimiento }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el movimiento.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
