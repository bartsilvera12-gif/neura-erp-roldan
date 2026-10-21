import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { ajustarStockUbicacion } from "@/lib/multideposito/server";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * GET /api/inventario/movimientos — lista movimientos via PostgREST (compat Hostinger sin pool PG).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const { data, error } = await ctx.supabase
      .from("movimientos_inventario")
      .select(
        "id, empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, fecha, created_at, updated_at, created_by, usuario_nombre"
      )
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
      .order("fecha", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ movimientos: data ?? [] }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/movimientos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los movimientos."), { status: 500 });
  }
}

type PostBody = {
  producto_id?: unknown;
  tipo?: unknown;
  cantidad?: unknown;
  costo_unitario?: unknown;
  origen?: unknown;
  referencia?: unknown;
  ubicacion_id?: unknown;
};

/**
 * POST /api/inventario/movimientos — registra un movimiento de stock.
 *
 * Si viene `ubicacion_id`, además ajusta la fila (empresa, producto, ubicacion)
 * en `inventario_stock_ubicacion` (suma para ENTRADA, resta para SALIDA, delta
 * signado para AJUSTE). El total global `productos.stock_actual` se actualiza
 * en paralelo (delta) para mantener compatibilidad con el resto de la app que
 * lee stock desde ahí.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const supabase = ctx.supabase;

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const producto_id = String(body.producto_id ?? "").trim();
    const tipo = String(body.tipo ?? "").toUpperCase();
    const cantidad = Number(body.cantidad);
    const costo_unitario = Number(body.costo_unitario) || 0;
    const origen = String(body.origen ?? "ajuste_manual");
    const referencia = typeof body.referencia === "string" && body.referencia.trim() ? body.referencia.trim() : null;
    const ubicacionId = typeof body.ubicacion_id === "string" && body.ubicacion_id.trim() ? body.ubicacion_id.trim() : null;

    if (!producto_id) return NextResponse.json(errorResponse("producto_id es obligatorio."), { status: 400 });
    if (!["ENTRADA", "SALIDA", "AJUSTE"].includes(tipo)) {
      return NextResponse.json(errorResponse("tipo debe ser ENTRADA, SALIDA o AJUSTE."), { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return NextResponse.json(errorResponse("cantidad debe ser un número distinto de 0."), { status: 400 });
    }
    // Un ajuste manual cambia el stock sin respaldo de una compra o una venta:
    // sin motivo escrito no hay forma de auditarlo después.
    if (tipo === "AJUSTE" && !referencia) {
      return NextResponse.json(
        errorResponse("El motivo es obligatorio para un ajuste de inventario."),
        { status: 400 }
      );
    }

    // Obtener datos del producto para snapshot y recálculo del stock global.
    const prodQ = await supabase
      .from("productos")
      .select("id, nombre, sku, stock_actual, costo_promedio")
      .eq("empresa_id", empresaId)
      .eq("id", producto_id)
      .maybeSingle();
    if (prodQ.error || !prodQ.data) {
      return NextResponse.json(errorResponse("Producto no encontrado."), { status: 404 });
    }
    const prod = prodQ.data as { id: string; nombre: string; sku: string; stock_actual: number; costo_promedio: number };

    // delta signado: ENTRADA suma, SALIDA resta, AJUSTE respeta el signo del payload.
    const cantAbs = Math.abs(cantidad);
    const delta =
      tipo === "ENTRADA" ? cantAbs :
      tipo === "SALIDA" ? -cantAbs :
      cantidad;

    // El stock no puede quedar negativo. Antes el `Math.max(0, ...)` de más
    // abajo lo tapaba: la salida se registraba igual y el stock caía a cero en
    // silencio, así que el movimiento y las existencias dejaban de cuadrar.
    const stockActual = Number(prod.stock_actual) || 0;
    if (delta < 0 && stockActual + delta < 0) {
      return NextResponse.json(
        errorResponse(
          `Stock insuficiente: "${prod.nombre}" tiene ${stockActual} y se intentan sacar ${Math.abs(delta)}.`
        ),
        { status: 400 }
      );
    }

    // Ajuste del stock por ubicación (solo si se especificó depósito).
    if (ubicacionId) {
      const err = await ajustarStockUbicacion(supabase, empresaId, ubicacionId, producto_id, delta);
      if (err) return NextResponse.json(errorResponse(`No se pudo ajustar el stock del depósito: ${err}`), { status: 400 });
    }

    // Quién lo hizo: un solo criterio para toda la app (ver firmaUsuario).
    const firma = await firmaUsuario(supabase, ctx.auth);

    // Insertar la fila del movimiento.
    const insert = await supabase
      .from("movimientos_inventario")
      .insert({
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        producto_id,
        producto_nombre: prod.nombre,
        producto_sku: prod.sku,
        tipo,
        cantidad: Math.abs(cantidad),
        costo_unitario,
        origen,
        referencia,
        fecha: new Date().toISOString(),
        created_by: firma.id,
        usuario_nombre: firma.nombre,
      })
      .select()
      .single();
    if (insert.error) {
      return NextResponse.json(errorResponse(insert.error.message), { status: 400 });
    }

    // Actualizar el stock global del producto (usado por el resto de la app).
    // Para ENTRADA con costo, recalcular CPP.
    const nuevoStock = Math.max(0, Number(prod.stock_actual) + delta);
    const patch: { stock_actual: number; costo_promedio?: number } = { stock_actual: nuevoStock };
    if (tipo === "ENTRADA" && costo_unitario > 0) {
      const stockPrev = prod.stock_actual > 0 ? prod.stock_actual : 0;
      const costoPrev = prod.costo_promedio ?? 0;
      patch.costo_promedio = stockPrev > 0
        ? (stockPrev * costoPrev + cantAbs * costo_unitario) / (stockPrev + cantAbs)
        : costo_unitario;
    }
    await supabase.from("productos").update(patch).eq("id", producto_id).eq("empresa_id", empresaId);

    return NextResponse.json(successResponse({ movimiento: insert.data }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/movimientos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el movimiento."), { status: 500 });
  }
}
