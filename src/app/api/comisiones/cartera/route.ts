import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { enCartera, diasRestantesCartera } from "@/lib/comisiones/calculo";

/**
 * Cartera por vendedor (puntos 4.1 y 4.3).
 *
 * GET  → clientes con su vendedor y si siguen en cartera.
 * POST → asignar un vendedor a un cliente, o liberarlo a mano.
 *
 * ── LA LIBERACIÓN SE CALCULA, NO SE BORRA ──────────────────────────────────
 *   El pedido dice "si no concreta otra operación en ese plazo, liberarlo
 *   automáticamente". Un proceso que vacíe el vendedor a los 30 días cumpliría
 *   al pie de la letra y perdería el dato de quién lo venía atendiendo —
 *   justo lo que sirve para reasignarlo o para discutir una comisión del mes
 *   pasado.
 *
 *   Acá el cliente queda LIBRE solo cuando pasan los días, sin borrar nada. Si
 *   vuelve a comprar, vuelve a su cartera sin que nadie toque nada.
 *
 * ── SOBRE EL REEMPLAZO (4.3) ───────────────────────────────────────────────
 *   "Si un vendedor está ausente, otro puede atender su cartera. La venta y su
 *   comisión corresponden a quien cierre la operación, pero el cliente
 *   permanece en la cartera original."
 *
 *   Por eso vender a un cliente NO cambia su `vendedor_usuario_id`: la venta
 *   guarda su propio vendedor (`ventas.vendedor_usuario_id`) y de ahí sale la
 *   comisión, mientras el cliente sigue en la cartera de siempre.
 *
 *   La venta de un reemplazo SÍ renueva los días de cartera. La alternativa
 *   —que solo cuenten las ventas del titular— le haría perder la cartera por
 *   estar enfermo, que es lo contrario de lo que el punto busca.
 */

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;
    const sp = new URL(request.url).searchParams;
    const vendedorFiltro = (sp.get("vendedor") ?? "").trim();
    const soloLibres = sp.get("libres") === "1";

    const cfg = await supabase
      .from("comisiones_config").select("dias_cartera")
      .eq("empresa_id", auth.empresa_id).maybeSingle();
    const diasCartera = Number((cfg.data as { dias_cartera?: number } | null)?.dias_cartera) || 30;

    let q = supabase
      .from("clientes")
      .select("id, nombre, empresa, nombre_contacto, vendedor_usuario_id, vendedor_asignado, cartera_desde")
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null)
      .order("nombre");
    if (vendedorFiltro) q = q.eq("vendedor_usuario_id", vendedorFiltro);

    const r = await q;
    if (r.error) {
      if (/cartera_desde|comisiones_config/.test(r.error.message ?? "")) {
        return NextResponse.json(
          errorResponse("Falta correr 24_comisiones_cartera.sql en la base."),
          { status: 500 }
        );
      }
      throw new Error(r.error.message);
    }

    const usuarios = await supabase
      .from("usuarios").select("id, nombre, email")
      .eq("empresa_id", auth.empresa_id).order("nombre");
    const nombreUsuario = new Map<string, string>();
    for (const u of (usuarios.data ?? []) as Array<Record<string, unknown>>) {
      nombreUsuario.set(String(u.id), String(u.nombre ?? u.email ?? ""));
    }

    const ahora = new Date();
    const filas = ((r.data ?? []) as Array<Record<string, unknown>>).map((c) => {
      const desde = c.cartera_desde == null ? null : String(c.cartera_desde);
      const vendedorId = c.vendedor_usuario_id == null ? null : String(c.vendedor_usuario_id);
      const activa = Boolean(vendedorId) && enCartera(desde, diasCartera, ahora);
      return {
        id: String(c.id),
        nombre: String(c.nombre ?? c.empresa ?? c.nombre_contacto ?? ""),
        vendedor_id: vendedorId,
        vendedor_nombre: vendedorId
          ? nombreUsuario.get(vendedorId) ?? String(c.vendedor_asignado ?? "")
          : null,
        cartera_desde: desde,
        en_cartera: activa,
        dias_restantes: activa ? diasRestantesCartera(desde, diasCartera, ahora) : 0,
      };
    });

    const visibles = soloLibres ? filas.filter((f) => !f.en_cartera) : filas;

    return NextResponse.json(successResponse({
      clientes: visibles,
      dias_cartera: diasCartera,
      resumen: {
        total: filas.length,
        en_cartera: filas.filter((f) => f.en_cartera).length,
        libres: filas.filter((f) => !f.en_cartera).length,
        sin_vendedor: filas.filter((f) => !f.vendedor_id).length,
      },
    }));
  } catch (err) {
    console.error("[/api/comisiones/cartera GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la cartera."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede cambiar la cartera."),
        { status: 403 }
      );
    }
    const { auth, supabase } = ctx;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clienteId = String(b.cliente_id ?? "").trim();
    if (!clienteId) return NextResponse.json(errorResponse("Falta el cliente."), { status: 400 });

    if (b.accion === "liberar") {
      // Liberar a mano: se borra la fecha, no el vendedor. El cliente queda
      // libre ya mismo y sigue constando quién lo atendía.
      const r = await supabase.from("clientes")
        .update({ cartera_desde: null })
        .eq("empresa_id", auth.empresa_id).eq("id", clienteId);
      if (r.error) throw new Error(r.error.message);
      return NextResponse.json(successResponse({ ok: true }));
    }

    const vendedorId = b.vendedor_id ? String(b.vendedor_id) : null;
    let vendedorNombre: string | null = null;
    if (vendedorId) {
      const u = await supabase.from("usuarios")
        .select("id, nombre, email").eq("empresa_id", auth.empresa_id)
        .eq("id", vendedorId).maybeSingle();
      if (u.error) throw new Error(u.error.message);
      if (!u.data) return NextResponse.json(errorResponse("Vendedor no encontrado."), { status: 404 });
      const row = u.data as { nombre?: string | null; email?: string | null };
      vendedorNombre = row.nombre ?? row.email ?? null;
    }

    const r = await supabase.from("clientes")
      .update({
        vendedor_usuario_id: vendedorId,
        vendedor_asignado: vendedorNombre,
        // Asignar arranca el reloj: el vendedor tiene los días configurados
        // para concretar algo antes de que el cliente vuelva a quedar libre.
        cartera_desde: vendedorId ? new Date().toISOString() : null,
      })
      .eq("empresa_id", auth.empresa_id).eq("id", clienteId);
    if (r.error) {
      if (/cartera_desde/.test(r.error.message ?? "")) {
        return NextResponse.json(
          errorResponse("Falta correr 24_comisiones_cartera.sql en la base."),
          { status: 500 }
        );
      }
      throw new Error(r.error.message);
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/comisiones/cartera POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la cartera."), { status: 500 });
  }
}
