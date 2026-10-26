import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isAdmin } from "@/lib/middleware/auth";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import {
  editarVentaPg,
  EdicionRechazada,
  type ItemEditado,
} from "@/lib/ventas/server/editar-venta-pg";

/**
 * PUT /api/ventas/[id]/editar — edita una venta emitida (punto 2.2).
 *
 * SOLO ADMINISTRADORES, como pide el punto. No es una restricción de confort:
 * editar mueve stock de algo que ya se entregó y cambia un comprobante que
 * puede estar en manos del cliente.
 *
 * GET devuelve el historial de ediciones de esa venta.
 *
 * El trabajo pesado está en `editar-venta-pg.ts`, con su transacción. Acá
 * quedan la autorización y la validación del payload.
 */

const IVAS = ["EXENTA", "5%", "10%"] as const;

function normalizarItems(raw: unknown): ItemEditado[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "La venta tiene que quedar con al menos un producto.";
  }
  const out: ItemEditado[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as Record<string, unknown>;
    const etiqueta = `Producto ${i + 1}`;
    const productoId = String(it.producto_id ?? "").trim();
    if (!productoId) return `${etiqueta}: falta el producto.`;

    const cantidad = Number(it.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return `${etiqueta}: la cantidad tiene que ser mayor a cero.`;
    }
    const precio = Number(it.precio_venta);
    if (!Number.isFinite(precio) || precio < 0) {
      return `${etiqueta}: el precio no puede ser negativo.`;
    }
    const iva = String(it.tipo_iva ?? "10%");
    if (!(IVAS as readonly string[]).includes(iva)) {
      return `${etiqueta}: el IVA tiene que ser EXENTA, 5% o 10%.`;
    }

    // Los totales se recalculan acá y NO se toman del navegador: es la misma
    // razón que en compras (ver costoEnGuaranies). Un total mandado a mano
    // dejaría la venta cuadrando mal contra sus propias líneas.
    const totalLinea = Math.round(cantidad * precio);
    const divisor = iva === "10%" ? 1.1 : iva === "5%" ? 1.05 : 1;
    const subtotal = Math.round(totalLinea / divisor);

    out.push({
      producto_id: productoId,
      producto_nombre: String(it.producto_nombre ?? ""),
      sku: it.sku == null ? null : String(it.sku),
      cantidad,
      precio_venta: precio,
      precio_venta_original: Number(it.precio_venta_original) || precio,
      tipo_iva: iva as ItemEditado["tipo_iva"],
      subtotal,
      monto_iva: totalLinea - subtotal,
      total_linea: totalLinea,
    });
  }
  return out;
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(
        errorResponse("Solo un administrador puede editar una venta emitida."),
        { status: 403 }
      );
    }

    const { id: ventaId } = await context.params;
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const motivo = String(body.motivo ?? "").trim();
    if (!motivo) {
      return NextResponse.json(errorResponse("Escribí el motivo del cambio."), { status: 400 });
    }

    const items = normalizarItems(body.items);
    if (typeof items === "string") {
      return NextResponse.json(errorResponse(items), { status: 400 });
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const r = await editarVentaPg({
      schema,
      empresaId,
      sucursalId,
      ventaId,
      motivo,
      usuarioId: firma.id,
      usuarioNombre: firma.nombre,
      items,
      clienteId: body.cliente_id === undefined
        ? undefined
        : body.cliente_id === null || body.cliente_id === ""
          ? null
          : String(body.cliente_id),
      tipoVenta: body.tipo_venta === "CREDITO" ? "CREDITO" : body.tipo_venta === "CONTADO" ? "CONTADO" : undefined,
      metodoPago: body.metodo_pago === undefined ? undefined : (body.metodo_pago as string | null),
      plazoDias: body.plazo_dias === undefined || body.plazo_dias === null || body.plazo_dias === ""
        ? null
        : parseInt(String(body.plazo_dias), 10) || null,
    });

    return NextResponse.json(successResponse(r));
  } catch (err) {
    if (err instanceof EdicionRechazada) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "";
    console.error("[/api/ventas/[id]/editar PUT]", msg);
    if (/ventas_ediciones|edicion_venta/.test(msg) && /does not exist|check constraint/.test(msg)) {
      return NextResponse.json(
        errorResponse("Falta correr 22_edicion_ventas.sql en la base."),
        { status: 500 }
      );
    }
    return NextResponse.json(errorResponse("No se pudo editar la venta."), { status: 500 });
  }
}

/** GET — historial de ediciones de esta venta. Cualquier usuario lo puede ver. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id: ventaId } = await context.params;

    const r = await ctx.supabase
      .from("ventas_ediciones")
      .select("id, fecha, usuario_nombre, cambios, total_antes, total_despues, tenia_factura, motivo")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("venta_id", ventaId)
      .order("fecha", { ascending: false });

    if (r.error) {
      // Sin la tabla, la venta simplemente no tiene ediciones registradas.
      if (/ventas_ediciones/.test(r.error.message ?? "")) {
        return NextResponse.json(successResponse({ ediciones: [], migrado: false }));
      }
      throw new Error(r.error.message);
    }
    return NextResponse.json(successResponse({ ediciones: r.data ?? [], migrado: true }));
  } catch (err) {
    console.error("[/api/ventas/[id]/editar GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo cargar el historial de ediciones."),
      { status: 500 }
    );
  }
}
