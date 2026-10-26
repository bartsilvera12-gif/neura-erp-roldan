import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { existenciasConReserva, reservasPorProducto } from "@/lib/presupuestos/server/reservas";

/**
 * GET /api/inventario/existencias — físico, reservado y disponible (punto 9.2).
 *
 *   ?productos=id1,id2   → solo esos (lo que usa el formulario de presupuesto)
 *   sin parámetros       → todos los productos que hoy tienen reserva
 *
 * El segundo caso es el que contesta "¿qué mercadería está comprometida?", que
 * es la pregunta del depósito antes de salir a entregar.
 */

const MAX_IDS = 300;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const crudo = (sp.get("productos") ?? "").trim();
    const ids = crudo
      ? crudo.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS)
      : [];

    if (ids.length > 0) {
      const filas = await existenciasConReserva(ctx.supabase, empresaId, sucursalId, ids);
      return NextResponse.json(successResponse({ existencias: filas }));
    }

    // Sin lista: solo los que tienen algo comprometido. Devolver el catálogo
    // entero con reservado = 0 sería una lista larga que no dice nada.
    const reservas = await reservasPorProducto(ctx.supabase, empresaId, sucursalId);
    const conReserva = [...reservas.keys()];
    const filas = await existenciasConReserva(ctx.supabase, empresaId, sucursalId, conReserva);
    return NextResponse.json(successResponse({
      existencias: filas.sort((a, b) => b.reservado - a.reservado),
      resumen: {
        productos_con_reserva: filas.length,
        unidades_reservadas: filas.reduce((s, f) => s + f.reservado, 0),
        // Los que ya están prometidos de más: lo que hay que mirar primero.
        sobrevendidos: filas.filter((f) => f.disponible < 0).length,
      },
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/existencias GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las existencias."), { status: 500 });
  }
}
