import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * POST /api/cajas/[id]/reabrir — reabre un turno cerrado (punto 5.1).
 *
 * "Permitir a administradores consultar o reabrir cajas anteriores con
 * controles y registro de operaciones."
 *
 * LOS CONTROLES, CONCRETAMENTE
 *   · Solo administradores.
 *   · Motivo obligatorio.
 *   · No se puede reabrir si el mismo número de caja ya tiene un turno activo:
 *     habría dos turnos abiertos sobre el mismo cajón y las ventas nuevas no
 *     sabrían a cuál pertenecen.
 *   · Queda registrado en la observación del cierre, que es donde alguien va a
 *     mirar cuando el arqueo de ese día no cierre.
 *
 * POR QUÉ NO SE BORRAN LOS NÚMEROS DEL CIERRE
 *   Al reabrir se conservan `monto_cierre_contado`, `diferencia` y el arqueo:
 *   son lo que se contó la primera vez. Si se borraran, nadie podría comparar
 *   el cierre original con el corregido, que es justamente lo que se quiere
 *   revisar cuando se reabre un turno.
 */

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede reabrir un turno de caja."),
        { status: 403 }
      );
    }

    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const { id: cajaId } = await context.params;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = String(b.motivo ?? "").trim();

    if (!motivo) {
      return NextResponse.json(
        errorResponse("Escribí por qué se reabre el turno."),
        { status: 400 }
      );
    }

    const cQ = await ctx.supabase
      .from("cajas")
      .select("id, numero_caja, estado, observacion_cierre, fecha_cierre")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .eq("id", cajaId)
      .maybeSingle();
    if (cQ.error) throw new Error(cQ.error.message);
    if (!cQ.data) return NextResponse.json(errorResponse("Turno no encontrado."), { status: 404 });

    const caja = cQ.data as {
      numero_caja: number; estado: string; observacion_cierre: string | null; fecha_cierre: string | null;
    };
    if (caja.estado !== "cerrada") {
      return NextResponse.json(
        errorResponse("Ese turno no está cerrado."),
        { status: 409 }
      );
    }

    // Dos turnos activos sobre el mismo número dejarían a las ventas nuevas
    // sin saber a cuál pertenecen.
    const activoQ = await ctx.supabase
      .from("cajas")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", sucursalId)
      .eq("numero_caja", caja.numero_caja)
      .in("estado", ["abierta", "en_cierre"])
      .limit(1);
    if (activoQ.error) throw new Error(activoQ.error.message);
    if ((activoQ.data ?? []).length > 0) {
      return NextResponse.json(
        errorResponse(
          `La Caja ${caja.numero_caja} tiene un turno activo ahora mismo. Cerralo antes de reabrir este.`
        ),
        { status: 409 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const sello = `[Reabierta el ${new Date().toISOString()} por ${firma.nombre}: ${motivo}]`;
    const observacion = caja.observacion_cierre
      ? `${caja.observacion_cierre}\n${sello}`
      : sello;

    const upd = await ctx.supabase
      .from("cajas")
      .update({
        estado: "abierta",
        // Se conservan los números del cierre original a propósito: son con
        // qué comparar cuando se vuelva a cerrar.
        fecha_cierre: null,
        cerrada_por: null,
        observacion_cierre: observacion,
        updated_at: new Date().toISOString(),
      })
      .eq("empresa_id", empresaId)
      .eq("id", cajaId)
      .eq("estado", "cerrada")
      .select("id, numero_caja, estado")
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) {
      return NextResponse.json(
        errorResponse("El turno cambió de estado mientras se reabría. Volvé a intentar."),
        { status: 409 }
      );
    }

    return NextResponse.json(successResponse({
      ok: true,
      numero_caja: caja.numero_caja,
      cierre_anterior: caja.fecha_cierre,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/cajas/[id]/reabrir]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo reabrir el turno."), { status: 500 });
  }
}
