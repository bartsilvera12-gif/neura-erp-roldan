import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { descuentoMaximoDe, lineasSobreTope } from "@/lib/ventas/server/descuento-maximo";
import { buscarAutorizaciones, marcarUsadas } from "@/lib/descuentos/server/solicitudes";
import { creditoDe, validarCredito } from "@/lib/clientes/server/credito";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { createVentaTransaccionalPg, StockInsuficienteError } from "@/lib/ventas/server/create-venta-pg";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import type { CreateVentaItemInput } from "@/lib/ventas/server/create-venta-pg";
import { insertVentaPagoDetalle } from "@/lib/ventas/server/pago-detalle-pg";
import type { MetodoPagoDetalle } from "@/lib/ventas/server/pago-detalle-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta } from "@/lib/ventas/types";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { estaFacturado, marcarFacturado } from "@/lib/caja/facturacion";

/** Error tipado: el pedido que se intenta facturar ya tiene venta. */
class PedidoYaFacturadoError extends Error {
  constructor() {
    super("Este pedido ya fue facturado.");
    this.name = "PedidoYaFacturadoError";
  }
}

const METODOS_PAGO_DETALLE = [
  "efectivo", "transferencia", "tarjeta", "qr", "billetera", "otro", "cheque",
] as const;

/** Valida el método que manda el cliente; cualquier otra cosa cae a 'efectivo'. */
function asMetodoPagoDetalle(v: unknown): MetodoPagoDetalle {
  return (METODOS_PAGO_DETALLE as readonly string[]).includes(String(v))
    ? (v as MetodoPagoDetalle)
    : "efectivo";
}

function asItems(body: unknown): CreateVentaItemInput[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CreateVentaItemInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const tipoIva = r.tipo_iva;
    if (tipoIva !== "EXENTA" && tipoIva !== "5%" && tipoIva !== "10%") return null;
    const tp = r.tipo_precio;
    const tipoPrecio: "minorista" | "mayorista" | "distribuidor" | "costo" =
      tp === "mayorista" || tp === "distribuidor" || tp === "costo" ? tp : "minorista";
    const loteId = typeof r.lote_id === "string" && r.lote_id.trim() ? r.lote_id.trim() : null;
    out.push({
      producto_id: String(r.producto_id ?? ""),
      producto_nombre: String(r.producto_nombre ?? ""),
      sku: String(r.sku ?? ""),
      cantidad: Number(r.cantidad),
      precio_venta_original: Number(r.precio_venta_original),
      precio_venta: Number(r.precio_venta),
      tipo_iva: tipoIva,
      tipo_precio: tipoPrecio,
      subtotal: Number(r.subtotal),
      monto_iva: Number(r.monto_iva),
      total_linea: Number(r.total_linea),
      lote_id: loteId,
    });
  }
  // NaN/Infinity bypasean el chequeo de coherencia de totales en
  // create-venta-pg.ts (Math.abs(NaN - x) > TOL es siempre false en JS), así
  // que se rechazan acá antes de llegar a esa validación.
  if (
    out.some(
      (i) =>
        !i.producto_id ||
        !(i.cantidad > 0) ||
        !Number.isFinite(i.precio_venta_original) ||
        !Number.isFinite(i.precio_venta) ||
        i.precio_venta < 0 ||
        !Number.isFinite(i.subtotal) ||
        !Number.isFinite(i.monto_iva) ||
        !Number.isFinite(i.total_linea)
    )
  ) {
    return null;
  }
  return out;
}

function toVentaResponse(
  items: CreateVentaItemInput[],
  meta: {
    id: string;
    numero_control: string;
    fechaIso: string;
    moneda: Venta["moneda"];
    tipo_cambio: number;
    tipo_venta: Venta["tipo_venta"];
    plazo_dias?: number;
    metodo_pago?: Venta["metodo_pago"];
    subtotal: number;
    monto_iva: number;
    total: number;
    genera_nota_remision?: boolean;
    caja_id?: string | null;
    nota_remision_numero?: string | null;
  }
): Venta {
  const lineas: LineaVenta[] = items.map((i) => ({
    producto_id: i.producto_id,
    producto_nombre: i.producto_nombre,
    sku: i.sku,
    cantidad: i.cantidad,
    precio_venta_original: i.precio_venta_original,
    precio_venta: i.precio_venta,
    tipo_iva: i.tipo_iva,
    tipo_precio: i.tipo_precio,
    subtotal: i.subtotal,
    monto_iva: i.monto_iva,
    total_linea: i.total_linea,
  }));
  return {
    id: meta.id,
    numero_control: meta.numero_control,
    items: lineas,
    moneda: meta.moneda,
    tipo_cambio: meta.tipo_cambio,
    subtotal: meta.subtotal,
    monto_iva: meta.monto_iva,
    total: meta.total,
    tipo_venta: meta.tipo_venta,
    plazo_dias: meta.plazo_dias,
    metodo_pago: meta.metodo_pago,
    genera_nota_remision: meta.genera_nota_remision === true,
    nota_remision_numero: meta.nota_remision_numero ?? null,
    fecha: meta.fechaIso,
  };
}

/**
 * POST /api/ventas/create — venta + ítems + stock + movimientos (una transacción Postgres).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    // Se resuelve una vez acá: la venta lo usa para el nombre del operador y
    // para el del vendedor, y pedirlo dos veces sería una consulta de más.
    const firma = await firmaUsuario(await createServiceRoleClientForEmpresa(auth.empresa_id), auth);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const items = asItems(body);
    if (!items) {
      return NextResponse.json(errorResponse("Payload inválido: items requeridos."), { status: 400 });
    }

    const o = body as Record<string, unknown>;
    const moneda = o.moneda === "USD" ? "USD" : "GS";
    const tipoCambio = Number(o.tipo_cambio) || 1;
    const tipoVenta = o.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO";
    const plazoDias =
      tipoVenta === "CREDITO" && o.plazo_dias != null && String(o.plazo_dias).trim() !== ""
        ? parseInt(String(o.plazo_dias), 10)
        : null;
    const metodoPago: "efectivo" | "tarjeta" | "transferencia" | "cheque" =
      o.metodo_pago === "tarjeta" || o.metodo_pago === "transferencia" || o.metodo_pago === "cheque"
        ? o.metodo_pago
        : "efectivo";
    const clienteRaw = o.cliente_id;
    const clienteId =
      clienteRaw === null || clienteRaw === undefined || clienteRaw === ""
        ? null
        : String(clienteRaw);
    const observaciones =
      o.observaciones === null || o.observaciones === undefined
        ? null
        : String(o.observaciones).slice(0, 4000);
    const permitirSinStock = o.permitir_sin_stock === true;
    const emitirFacturaFlag = o.emitir_factura !== false;

    // Defensa en profundidad: estas dos reglas hoy solo viven en el frontend
    // (ventas/nueva/page.tsx). Una llamada directa a la API podía saltarlas:
    //  - CREDITO sin cliente: la venta se creaba igual con tipo_venta='CREDITO'
    //    pero createVentaTransaccionalPg solo abre CxC si hay clienteId — quedaba
    //    "fiado" sin ningún mecanismo de cobranza asociado.
    //  - emitir_factura=true sin cliente: SIFEN exige receptor; se descontaba
    //    stock y creaba la venta antes de que el puente venta→factura fallara
    //    (o peor, generara una FAC-XXXXXX sin razón social/RUC).
    if (tipoVenta === "CREDITO" && !clienteId) {
      return NextResponse.json(
        errorResponse("Una venta a crédito requiere un cliente seleccionado."),
        { status: 400 }
      );
    }
    if (emitirFacturaFlag && !clienteId) {
      return NextResponse.json(
        errorResponse("Para emitir factura electrónica se requiere un cliente seleccionado."),
        { status: 400 }
      );
    }
    // Pedido (proyecto) que se está facturando desde Caja. Opcional.
    const pedidoId = typeof o.pedido_id === "string" && o.pedido_id.trim() ? o.pedido_id.trim() : null;

    // Pedido de cocina (modalidad obligatoria en instancia Neura ERP Roldán e Hijos)
    const pedidoRaw = (o.pedido_cocina ?? null) as Record<string, unknown> | null;
    type PedidoCocinaParsed = {
      modalidad: "local" | "delivery" | "carry_out";
      mesa: string | null;
      cliente_nombre: string | null;
      cliente_telefono: string | null;
      direccion_entrega: string | null;
      observacion: string | null;
    };
    let pedidoCocina: PedidoCocinaParsed | null = null;
    if (pedidoRaw && typeof pedidoRaw === "object") {
      const m = pedidoRaw.modalidad;
      if (m !== "local" && m !== "delivery" && m !== "carry_out") {
        return NextResponse.json(
          errorResponse("Modalidad de pedido inválida (local | delivery | carry_out)."),
          { status: 400 }
        );
      }
      const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const mesa = trim(pedidoRaw.mesa);
      const cliNombre = trim(pedidoRaw.cliente_nombre);
      const cliTel = trim(pedidoRaw.cliente_telefono);
      const direccion = trim(pedidoRaw.direccion_entrega);
      const obs = trim(pedidoRaw.observacion);
      if (m === "delivery" && (cliTel.length === 0 || direccion.length === 0)) {
        return NextResponse.json(
          errorResponse("Teléfono y dirección requeridos para Delivery."),
          { status: 400 }
        );
      }
      pedidoCocina = {
        modalidad: m,
        mesa: mesa || null,
        cliente_nombre: cliNombre || null,
        cliente_telefono: cliTel || null,
        direccion_entrega: direccion || null,
        observacion: obs || null,
      };
    }

    const subtotalDeclarado = Number(o.subtotal);
    const montoIvaDeclarado = Number(o.monto_iva);
    const totalDeclarado = Number(o.total);

    if ([subtotalDeclarado, montoIvaDeclarado, totalDeclarado].some((n) => !Number.isFinite(n))) {
      return NextResponse.json(errorResponse("Totales inválidos."), { status: 400 });
    }

    if (moneda === "USD" && tipoCambio <= 0) {
      return NextResponse.json(errorResponse("Tipo de cambio inválido para USD."), { status: 400 });
    }

    // ── Tope de descuento del usuario (punto 2.3) ─────────────────────────
    // Va acá, antes de tocar stock o numeración: una venta rechazada no tiene
    // que dejar nada a medio hacer. Esconder el campo en Caja no alcanza —
    // el precio igual se puede mandar por fuera de la pantalla.
    //
    // Una línea por encima del tope todavía puede pasar: si un administrador
    // autorizó ese descuento para ese vendedor y ese producto, el permiso vale
    // una venta. Las autorizaciones se marcan usadas DESPUÉS de crear la venta
    // —ver el comentario en `solicitudes.ts`—, porque Caja reintenta el POST
    // cuando falta stock y quemarlas acá rompería ese reintento.
    let autorizacionesAConsumir: string[] = [];
    {
      const sbTope = await createServiceRoleClientForEmpresa(auth.empresa_id);
      const tope = await descuentoMaximoDe(sbTope, auth.empresa_id, auth.usuarioCatalogId);
      const pasadas = lineasSobreTope(items, tope);
      if (pasadas.length > 0) {
        let permiso: Awaited<ReturnType<typeof buscarAutorizaciones>> = {
          ok: false,
          faltaPara: pasadas[0]!.producto_nombre || "un producto",
        };
        try {
          permiso = await buscarAutorizaciones(
            sbTope,
            auth.empresa_id,
            auth.usuarioCatalogId ?? "",
            pasadas.map((l) => ({ producto_id: l.producto_id, producto_nombre: l.producto_nombre, pct: l.pct }))
          );
        } catch (e) {
          // Sin la tabla del script 35 no hay autorizaciones que valer: el
          // tope sigue valiendo, que es el comportamiento anterior.
          console.error("[ventas/create] autorizaciones:", e instanceof Error ? e.message : e);
        }

        if (!permiso.ok) {
          const l = pasadas[0]!;
          const nombre = l.producto_nombre ? `"${l.producto_nombre}"` : "una línea";
          return NextResponse.json(
            errorResponse(
              tope === 0
                ? `Tu usuario no tiene permitido aplicar descuentos, y ${nombre} tiene ${l.pct.toFixed(1)}% menos que el precio de lista.`
                : `El descuento de ${nombre} es ${l.pct.toFixed(1)}% y tu tope es ${tope}%. Pedí autorización desde la línea del producto.`
            ),
            { status: 403 }
          );
        }
        autorizacionesAConsumir = permiso.ids;
      }
    }

    // ── Crédito del cliente ───────────────────────────────────────────────
    // Va junto al tope de descuento y por el mismo motivo: un límite que solo
    // se mira en la pantalla no frena nada, y el saldo cambia mientras el
    // vendedor arma la venta —otro cajero puede estar cobrándole al mismo
    // cliente—, así que el número que vale es el de este momento.
    if (tipoVenta === "CREDITO" && clienteId) {
      try {
        const sbCred = await createServiceRoleClientForEmpresa(auth.empresa_id);
        const credito = await creditoDe(sbCred, auth.empresa_id, clienteId);
        const total = items.reduce((t, i) => t + i.total_linea, 0);
        const problema = validarCredito(credito, total, plazoDias);
        if (problema) {
          return NextResponse.json(errorResponse(problema), { status: 403 });
        }
      } catch (e) {
        // Si la consulta falla —tabla que falta, red— no se bloquea la venta:
        // dejar de vender porque no se pudo leer un límite es peor que la
        // venta que ese límite habría frenado.
        console.error("[ventas/create] credito cliente:", e instanceof Error ? e.message : e);
      }
    }

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);

    // Anti doble facturación: si se factura un pedido, verificar que aún no tenga venta.
    // (Se valida ANTES de crear la venta para no descontar stock por un pedido ya facturado.)
    const sbPedido = pedidoId ? createServiceRoleClientWithDbSchema(schema) : null;
    if (pedidoId && sbPedido) {
      const pq = await sbPedido
        .from("proyectos")
        .select("id, metadata")
        .eq("empresa_id", auth.empresa_id)
        .eq("id", pedidoId)
        .maybeSingle();
      if (pq.error) throw new Error(pq.error.message);
      if (!pq.data) {
        return NextResponse.json(errorResponse("El pedido a facturar no existe."), { status: 404 });
      }
      if (estaFacturado((pq.data as { metadata?: unknown }).metadata)) {
        throw new PedidoYaFacturadoError();
      }
    }

    const { ventaId, numeroControl, fechaIso, notaRemisionNumero, facturaId, numeroFactura, facturaWarning } = await createVentaTransaccionalPg({
      schema,
      empresaId: auth.empresa_id,
      sucursalId: exigirSucursal(auth.sucursal_id),
      clienteId,
      observaciones,
      moneda,
      tipoCambio,
      tipoVenta,
      plazoDias: Number.isFinite(plazoDias as number) ? plazoDias : null,
      metodoPago,
      items,
      subtotalDeclarado,
      montoIvaDeclarado,
      totalDeclarado,
      pedidoCocina,
      permitirSinStock,
      generaNotaRemision: o.genera_nota_remision === true,
      cajaId: o.caja_id != null && String(o.caja_id).trim() !== "" ? String(o.caja_id) : null,
      // Default true (compat) — solo se salta el puente venta→factura si el
      // cajero explícitamente eligió "solo ticket" al confirmar la venta.
      emitirFactura: emitirFacturaFlag,
      createdBy: auth.usuarioCatalogId ?? null,
      // El nombre y no el email: es lo que se ve en Movimientos, en la hoja de
      // comisiones que el vendedor firma y en el detalle de la caja. Un
      // "ventas03@..." ahí no le dice nada a nadie.
      usuarioNombre: firma.nombre,
      // Punto 4.3: la venta y su comisión son de quien la cerró. El cliente
      // sigue en la cartera de su vendedor de siempre, que es lo que hace el
      // bloque de más abajo al renovar `cartera_desde` sin cambiar el dueño.
      vendedorUsuarioId: auth.usuarioCatalogId ?? null,
      vendedorNombre: firma.nombre,
    });

    // Vincular el pedido facturado con la venta creada (Caja). Trazabilidad:
    // presupuesto → pedido → venta. Marca el pedido como 'facturado' con venta_id.
    // Best-effort: la venta ya existe; si esto falla, la venta NO se revierte (se loguea).
    if (pedidoId && sbPedido) {
      try {
        const pq = await sbPedido
          .from("proyectos")
          .select("metadata")
          .eq("empresa_id", auth.empresa_id)
          .eq("id", pedidoId)
          .maybeSingle();
        const metaActual = (pq.data as { metadata?: unknown } | null)?.metadata;
        const nuevaMeta = marcarFacturado(metaActual, fechaIso, ventaId, numeroControl);
        const upd = await sbPedido
          .from("proyectos")
          .update({ metadata: nuevaMeta, last_activity_at: fechaIso, ultimo_movimiento_at: fechaIso })
          .eq("empresa_id", auth.empresa_id)
          .eq("id", pedidoId);
        if (upd.error) {
          console.error("[ventas/create] no se pudo marcar pedido facturado:", upd.error.message);
        }
      } catch (e) {
        console.error("[ventas/create] link pedido->venta fallo (venta OK):", e instanceof Error ? e.message : e);
      }
    }

    // Detalle de cobro (conciliación) — best-effort, FUERA de la transacción de
    // venta. Si falla, la venta queda igual (no se rompe ni se afectan recetas).
    //
    // Dos formas:
    //   · `pagos: [...]`  → pago MIXTO: una fila por método. Si hay más de un
    //                       método distinto, la venta se marca metodo_pago='mixto'
    //                       para que el arqueo de caja desglose por `ventas_pagos_detalle`.
    //   · `pago_detalle`  → un solo cobro: método = metodoPago, monto = total.
    try {
      const str = (v: unknown, max = 200) =>
        v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim().slice(0, max);
      const fechaDe = (v: unknown) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      const pagosArr = Array.isArray(o.pagos) ? (o.pagos as Record<string, unknown>[]) : null;

      if (pagosArr && pagosArr.length > 0) {
        for (const p of pagosArr) {
          const monto = Number(p.monto);
          // Un monto no positivo no es un cobro: se saltea en vez de ensuciar la conciliación.
          if (!Number.isFinite(monto) || monto <= 0) continue;
          await insertVentaPagoDetalle(schema, auth.empresa_id, ventaId, {
            metodo_pago: asMetodoPagoDetalle(p.metodo_pago),
            entidad_bancaria_id: p.entidad_bancaria_id ? String(p.entidad_bancaria_id) : null,
            entidad_nombre_snapshot: str(p.entidad_nombre_snapshot),
            monto,
            referencia: str(p.referencia),
            titular: str(p.titular),
            fecha_acreditacion: fechaDe(p.fecha_acreditacion),
            observacion: str(p.observacion, 500),
          });
        }

        const metodosUnicos = new Set(
          pagosArr
            .map((p) => (typeof p.metodo_pago === "string" ? p.metodo_pago : null))
            .filter(Boolean)
        );
        if (metodosUnicos.size > 1) {
          const upd = await createServiceRoleClientWithDbSchema(schema)
            .from("ventas")
            .update({ metodo_pago: "mixto" })
            .eq("id", ventaId)
            .eq("empresa_id", auth.empresa_id);
          if (upd.error) {
            console.error(
              "[ventas/create] no se pudo marcar la venta como 'mixto':",
              upd.error.message
            );
          }
        }
      } else {
        const pd = (o.pago_detalle ?? null) as Record<string, unknown> | null;
        await insertVentaPagoDetalle(schema, auth.empresa_id, ventaId, {
          metodo_pago: metodoPago,
          entidad_bancaria_id: pd?.entidad_bancaria_id ? String(pd.entidad_bancaria_id) : null,
          entidad_nombre_snapshot: str(pd?.entidad_nombre_snapshot),
          monto: totalDeclarado,
          referencia: str(pd?.referencia),
          titular: str(pd?.titular),
          fecha_acreditacion: fechaDe(pd?.fecha_acreditacion),
          observacion: str(pd?.observacion, 500),
        });
      }
    } catch (e) {
      console.error("[ventas/create] pago_detalle best-effort fallo (venta OK):", e instanceof Error ? e.message : e);
    }

    let sub = 0;
    let iv = 0;
    let tot = 0;
    for (const it of items) {
      sub += it.subtotal;
      iv += it.monto_iva;
      tot += it.total_linea;
    }

    const venta = toVentaResponse(items, {
      id: ventaId,
      numero_control: numeroControl,
      fechaIso,
      moneda,
      tipo_cambio: tipoCambio,
      tipo_venta: tipoVenta,
      plazo_dias: tipoVenta === "CREDITO" ? plazoDias ?? undefined : undefined,
      metodo_pago: metodoPago,
      subtotal: sub,
      monto_iva: iv,
      total: tot,
      genera_nota_remision: !!notaRemisionNumero,
      nota_remision_numero: notaRemisionNumero,
    });

    // ── Consumir las autorizaciones de descuento ──────────────────────────
    // La venta ya está hecha: una autorización vale una sola venta, así que
    // acá se cierran. Va best-effort —si falla, se anota y la autorización
    // queda viva hasta que vence— porque una venta registrada no se cae por
    // no poder marcar un permiso.
    if (autorizacionesAConsumir.length > 0) {
      try {
        const sbAut = await createServiceRoleClientForEmpresa(auth.empresa_id);
        await marcarUsadas(sbAut, auth.empresa_id, autorizacionesAConsumir, ventaId);
      } catch (e) {
        console.error("[ventas/create] marcar autorizaciones:", e instanceof Error ? e.message : e);
      }
    }

    // ── Renovar la cartera del cliente (puntos 4.1 y 4.3) ─────────────────
    // Una operación reinicia los días que el cliente permanece en la cartera
    // de su vendedor. NO se cambia a quién pertenece: si la cerró un
    // reemplazo, la comisión es suya (va en ventas.vendedor_usuario_id) pero
    // el cliente sigue en la cartera original, que es lo que pide el 4.3.
    //
    // Va best-effort y al final: la venta ya está hecha y confirmada, y no
    // tiene por qué fallar porque no se pudo tocar una fecha.
    if (clienteId) {
      try {
        const sbCartera = await createServiceRoleClientForEmpresa(auth.empresa_id);
        const upd = await sbCartera
          .from("clientes")
          .update({ cartera_desde: new Date().toISOString() })
          .eq("empresa_id", auth.empresa_id)
          .eq("id", clienteId)
          // Solo si tiene vendedor: sin dueño, la cartera no significa nada.
          .not("vendedor_usuario_id", "is", null);
        if (upd.error && !/cartera_desde/.test(upd.error.message ?? "")) {
          console.warn("[ventas/create] cartera_desde:", upd.error.message);
        }
      } catch (e) {
        console.warn("[ventas/create] cartera_desde:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(successResponse({
      venta,
      nota_remision_numero: notaRemisionNumero,
      // Puente Venta → Factura ERP (SIFEN). El front usa `factura.id` para
      // redirigir al detalle /facturas/[id] donde vive el panel SIFEN.
      factura: facturaId ? { id: facturaId, numero_factura: numeroFactura } : null,
      factura_warning: facturaWarning ?? null,
    }));
  } catch (err) {
    // Falta de stock sin autorizar: 409 con el detalle de faltantes para que la UI
    // muestre el modal de confirmación y reintente con permitir_sin_stock=true.
    if (err instanceof StockInsuficienteError) {
      return NextResponse.json(
        { ...errorResponse("Stock insuficiente: requiere confirmación."), faltantes: err.faltantes },
        { status: 409 }
      );
    }
    if (err instanceof PedidoYaFacturadoError) {
      return NextResponse.json(errorResponse(err.message), { status: 409 });
    }
    const msg = err instanceof Error ? err.message : "Error al crear la venta.";
    const status =
      msg.includes("Stock insuficiente") ||
      msg.includes("no existen") ||
      msg.includes("Cliente no encontrado") ||
      msg.includes("Totales no coinciden") ||
      msg.includes("al menos un")
        ? 400
        : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
