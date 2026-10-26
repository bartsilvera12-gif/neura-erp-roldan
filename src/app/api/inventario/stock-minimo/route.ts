import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { exigirSucursal, respuestaSucursalNoAsignada, aplicarFiltroSucursal } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireAdminProductos } from "@/lib/productos/require-admin-productos";
import { calcularMinimosSugeridos } from "@/lib/inventario/server/stock-minimo-pg";

/**
 * POST /api/inventario/stock-minimo — aplica el mínimo sugerido (punto 1.2).
 *
 * Escribe en `productos.stock_minimo` la mediana de ventas mensuales de los
 * últimos seis meses. El cálculo vive en `stock-minimo-pg.ts`.
 *
 * POR QUÉ ES UN BOTÓN Y NO UN PROCESO SILENCIOSO
 *   El pedido dice "actualizarlo automáticamente", y de eso se trata: nadie
 *   tipea mínimos producto por producto. Pero pisar sin aviso un mínimo que
 *   alguien puso a mano — porque el proveedor tarda, porque es un artículo
 *   crítico — es perder información que el sistema no tiene cómo recuperar.
 *   Por eso se recalcula solo y se muestra siempre, y la escritura es un acto
 *   explícito: se ve cuántos cambian antes de confirmar.
 *
 * Cuerpo opcional:
 *   solo_vacios — true escribe únicamente donde hoy el mínimo es 0 o nulo.
 *                 Es la opción conservadora: no toca nada cargado a mano.
 *   producto_ids — limita a esos productos.
 */

export async function POST(request: NextRequest) {
  try {
    // Cambiar el mínimo cambia qué se compra: misma puerta que editar el producto.
    const guard = await requireAdminProductos(request);
    if (!guard.ok) return guard.response;
    const { auth, supabase } = guard.ctx;

    const empresaId = auth.empresa_id;
    const sucursalId = exigirSucursal(auth.sucursal_id);
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const soloVacios = body.solo_vacios === true;
    const idsPedidos = Array.isArray(body.producto_ids)
      ? body.producto_ids.map(String).filter(Boolean)
      : null;

    const minimos = await calcularMinimosSugeridos(schema, empresaId, sucursalId);
    if (minimos.size === 0) {
      return NextResponse.json(successResponse({
        actualizados: 0,
        sin_cambios: 0,
        mensaje: "No hay ventas en los últimos seis meses para calcular mínimos.",
      }));
    }

    // El mínimo actual, para escribir solo lo que cambia.
    const actualesQ = await aplicarFiltroSucursal(
      supabase
        .from("productos")
        .select("id, stock_minimo, controla_stock")
        .eq("empresa_id", empresaId)
        .eq("activo", true),
      sucursalId
    );
    if (actualesQ.error) throw new Error(actualesQ.error.message);

    const actuales = new Map<string, { minimo: number; controla: boolean }>();
    for (const p of (actualesQ.data ?? []) as Array<Record<string, unknown>>) {
      actuales.set(String(p.id), {
        minimo: Number(p.stock_minimo) || 0,
        controla: p.controla_stock !== false,
      });
    }

    let actualizados = 0;
    let sinCambios = 0;
    const errores: string[] = [];

    for (const [productoId, m] of minimos) {
      if (idsPedidos && !idsPedidos.includes(productoId)) continue;
      const actual = actuales.get(productoId);
      // Puede no estar: producto de otra sucursal, dado de baja, o que no
      // controla stock. En ninguno de esos casos corresponde tocar el mínimo.
      if (!actual || !actual.controla) continue;
      if (soloVacios && actual.minimo > 0) { sinCambios++; continue; }

      const nuevo = Math.ceil(m.mediana);
      if (nuevo === actual.minimo) { sinCambios++; continue; }

      const upd = await supabase
        .from("productos")
        .update({ stock_minimo: nuevo, updated_at: new Date().toISOString() })
        .eq("empresa_id", empresaId)
        .eq("id", productoId);
      if (upd.error) { errores.push(upd.error.message); continue; }
      actualizados++;
    }

    return NextResponse.json(successResponse({
      actualizados,
      sin_cambios: sinCambios,
      errores: errores.length,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/inventario/stock-minimo]", msg);
    if (/Pool no disponible/.test(msg)) {
      return NextResponse.json(
        errorResponse("No hay conexión directa a la base para calcular los mínimos."),
        { status: 503 }
      );
    }
    return NextResponse.json(
      errorResponse("No se pudieron actualizar los mínimos."),
      { status: 500 }
    );
  }
}
