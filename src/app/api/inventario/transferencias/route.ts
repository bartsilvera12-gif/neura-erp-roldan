import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { ajustarStockUbicacion } from "@/lib/multideposito/server";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";

/**
 * POST /api/inventario/transferencias — mueve stock de un depósito a otro.
 *
 * Body: { producto_id, origen_id, destino_id, cantidad, motivo? }
 *
 * No existía forma de hacer esto: la pantalla de depósitos decía que se hacía
 * con Notas de Remisión, que en esta instancia no está habilitado, así que el
 * stock quedaba atrapado donde se hubiera cargado.
 *
 * El stock GLOBAL del producto no cambia: solo se reparte distinto. Por eso se
 * escriben dos movimientos (SALIDA en el origen, ENTRADA en el destino) que se
 * compensan en el kardex y dejan el rastro de a dónde fue cada unidad.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sb = ctx.supabase;

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const productoId = String(b.producto_id ?? "").trim();
    const origenId = String(b.origen_id ?? "").trim();
    const destinoId = String(b.destino_id ?? "").trim();
    const cantidad = Math.abs(Number(b.cantidad));
    const motivo = typeof b.motivo === "string" && b.motivo.trim() ? b.motivo.trim().slice(0, 200) : null;

    if (!productoId) return NextResponse.json(errorResponse("Elegí el producto."), { status: 400 });
    if (!origenId || !destinoId) {
      return NextResponse.json(errorResponse("Elegí el depósito de origen y el de destino."), { status: 400 });
    }
    if (origenId === destinoId) {
      return NextResponse.json(errorResponse("El origen y el destino no pueden ser el mismo depósito."), { status: 400 });
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return NextResponse.json(errorResponse("La cantidad debe ser mayor a cero."), { status: 400 });
    }

    const prodQ = await sb
      .from("productos")
      .select("id, nombre, sku, costo_promedio")
      .eq("empresa_id", empresaId).eq("id", productoId)
      .maybeSingle();
    if (prodQ.error || !prodQ.data) {
      return NextResponse.json(errorResponse("Producto no encontrado."), { status: 404 });
    }
    const prod = prodQ.data as { nombre: string; sku: string; costo_promedio: number };

    const ubiQ = await sb
      .from("inventario_ubicaciones")
      .select("id, nombre")
      .eq("empresa_id", empresaId).in("id", [origenId, destinoId]);
    if (ubiQ.error) throw new Error(ubiQ.error.message);
    const nombrePorUbi = new Map(
      ((ubiQ.data ?? []) as Array<Record<string, unknown>>).map((u) => [String(u.id), String(u.nombre ?? "")])
    );
    if (!nombrePorUbi.has(origenId) || !nombrePorUbi.has(destinoId)) {
      return NextResponse.json(errorResponse("Alguno de los depósitos no existe."), { status: 404 });
    }
    const nombreOrigen = nombrePorUbi.get(origenId)!;
    const nombreDestino = nombrePorUbi.get(destinoId)!;

    // ORDEN: primero el kardex, después el stock.
    //
    // Antes era al revés: se movía el stock y recién ahí se escribía el
    // kardex. Como el CHECK de `origen` no admitía 'transferencia' (hasta el
    // script 61), el insert fallaba siempre y la mercadería cambiaba de
    // depósito sin dejar rastro: en producción hay 0 movimientos con ese
    // origen. Con el kardex adelante, si no se puede registrar no se mueve
    // nada; si después falla el stock, se borran los dos asientos.
    const firma = await firmaUsuario(sb, ctx.auth);
    const ahora = new Date().toISOString();
    const comun = {
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      producto_id: productoId,
      producto_nombre: prod.nombre,
      producto_sku: prod.sku,
      cantidad,
      costo_unitario: Number(prod.costo_promedio) || 0,
      origen: "transferencia",
      fecha: ahora,
      created_by: firma.id,
      usuario_nombre: firma.nombre,
    };
    const sufijo = motivo ? ` — ${motivo}` : "";
    const mov = await sb
      .from("movimientos_inventario")
      .insert([
        { ...comun, tipo: "SALIDA", referencia: `Transferencia a ${nombreDestino}${sufijo}` },
        { ...comun, tipo: "ENTRADA", referencia: `Transferencia desde ${nombreOrigen}${sufijo}` },
      ])
      .select("id");
    if (mov.error) {
      console.error("[/api/inventario/transferencias] kardex", mov.error.message);
      return NextResponse.json(
        errorResponse("No se pudo registrar la transferencia en el kardex; el stock no se movió."),
        { status: 500 }
      );
    }
    const idsKardex = ((mov.data ?? []) as Array<{ id: string }>).map((m) => m.id);
    const deshacerKardex = async () => {
      if (idsKardex.length === 0) return;
      const del = await sb.from("movimientos_inventario").delete().eq("empresa_id", empresaId).in("id", idsKardex);
      if (del.error) console.error("[/api/inventario/transferencias] deshacer kardex", del.error.message);
    };

    // 1) Sacar del origen. Si no alcanza, se borra el kardex y no se tocó stock.
    const errSalida = await ajustarStockUbicacion(sb, empresaId, origenId, productoId, -cantidad);
    if (errSalida) {
      await deshacerKardex();
      return NextResponse.json(errorResponse(`No se pudo sacar del origen: ${errSalida}`), { status: 400 });
    }

    // 2) Meter en el destino. Si falla, se devuelve al origen y se borra el
    //    kardex: no hay transacción entre estas llamadas.
    const errEntrada = await ajustarStockUbicacion(sb, empresaId, destinoId, productoId, cantidad);
    if (errEntrada) {
      await ajustarStockUbicacion(sb, empresaId, origenId, productoId, cantidad);
      await deshacerKardex();
      return NextResponse.json(
        errorResponse(`No se pudo ingresar al destino: ${errEntrada}. La transferencia se deshizo.`),
        { status: 400 }
      );
    }

    return NextResponse.json(successResponse({
      ok: true,
      producto: prod.nombre,
      cantidad,
      origen: nombreOrigen,
      destino: nombreDestino,
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/transferencias POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo hacer la transferencia."), { status: 500 });
  }
}
