import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { descuentoMaximoDe, lineasSobreTope, topesPorArticulo } from "@/lib/ventas/server/descuento-maximo";
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
import { esIdManual, productoItemManual } from "@/lib/ventas/server/item-manual";
import type { Venta, LineaVenta } from "@/lib/ventas/types";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { estaFacturado, marcarFacturado } from "@/lib/caja/facturacion";
import { saldoDeCliente, consumirAnticipos } from "@/lib/anticipos/server/aplicar";
import { registrarModificacionAdministrativa } from "@/lib/auditoria/server/modificaciones";
import { recalcularCategorias } from "@/lib/clientes/server/categorias-pg";
import { periodoPy } from "@/lib/clientes/categoria-automatica";

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
      // Línea escrita a mano ("manual:<n>" o vacío): se resuelve más abajo al
      // producto genérico "ÍTEM A MANO" de la sucursal.
      producto_id: esIdManual(r.producto_id) ? "manual" : String(r.producto_id ?? ""),
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
        (i.producto_id === "manual" && !i.producto_nombre.trim()) ||
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
    if (items.some((i) => i.producto_id === "manual")) {
      const idManual = await productoItemManual(
        await createServiceRoleClientForEmpresa(auth.empresa_id),
        auth.empresa_id,
        exigirSucursal(auth.sucursal_id)
      );
      for (const i of items) if (i.producto_id === "manual") i.producto_id = idManual;
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
    // No se factura sin stock, y punto. Antes la caja mostraba un modal de
    // confirmación y reintentaba con `permitir_sin_stock: true`: eso dejaba
    // salir mercadería que no estaba, y el stock quedaba en negativo
    // arrastrando el error a la compra siguiente y al inventario valorizado.
    //
    // El campo se sigue leyendo para no romper a quien lo mande, pero ya no
    // habilita nada: la decisión es del servidor, no del navegador.
    const permitirSinStock = false;
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
      // Y el tope propio de cada artículo: el "descuento" que el administrador
      // carga en Rubros no es un precio rebajado, es hasta cuánto se puede
      // bajar ese artículo. Tienen que cumplirse los dos.
      const topesArt = await topesPorArticulo(
        sbTope,
        auth.empresa_id,
        items.map((l) => String((l as { producto_id?: string | null }).producto_id ?? ""))
      );
      const pasadas = lineasSobreTope(items, tope, topesArt);
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
                : `El descuento de ${nombre} es ${l.pct.toFixed(1)}% y el tope de esa línea es ${
                    Math.min(tope ?? 100, topesArt.get(l.producto_id) ?? 100)
                  }%. Pedí autorización desde la línea del producto.`
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

    // ── Anticipo del cliente aplicado a esta venta (punto 5.6) ───────────
    //
    //   El cliente dejó plata a cuenta hace días; hoy se lleva la mercadería
    //   y paga la diferencia. La venta vale lo mismo: lo que cambia es cuánto
    //   efectivo entra HOY al cajón, y para eso la venta guarda cuánto salió
    //   del anticipo.
    //
    //   Se valida ACÁ, antes de tocar stock o numeración: una venta rechazada
    //   no tiene que dejar nada a medio hacer. El descuento real del saldo se
    //   hace después de que la venta exista — ver el bloque de más abajo.
    const anticipoPedido = Math.round(Number(o.anticipo_aplicado) || 0);
    if (anticipoPedido > 0) {
      if (!clienteId) {
        return NextResponse.json(
          errorResponse("Para usar un anticipo hay que elegir el cliente: el anticipo es de alguien."),
          { status: 400 }
        );
      }
      if (tipoVenta === "CREDITO") {
        // En una venta a crédito no entra plata hoy: lo que habría que bajar
        // es la cuenta por cobrar, y eso es otro camino (un cobro con el
        // anticipo). Mezclarlo acá dejaría la deuda del cliente mal.
        return NextResponse.json(
          errorResponse(
            "El anticipo se aplica a ventas al contado. Para una venta a crédito, registrá el cobro con el anticipo desde Cobros."
          ),
          { status: 400 }
        );
      }
      if (anticipoPedido > totalDeclarado) {
        return NextResponse.json(
          errorResponse("El anticipo a usar no puede ser mayor que el total de la venta."),
          { status: 400 }
        );
      }
      const sbAnt = await createServiceRoleClientForEmpresa(auth.empresa_id);
      let saldo = { saldo: 0, aviso: null as string | null };
      try {
        saldo = await saldoDeCliente(
          sbAnt,
          auth.empresa_id,
          exigirSucursal(auth.sucursal_id),
          clienteId
        );
      } catch (e) {
        console.error("[ventas/create] no se pudo leer el saldo de anticipos", e);
        return NextResponse.json(
          errorResponse("No se pudo verificar el anticipo del cliente. Probá de nuevo."),
          { status: 500 }
        );
      }
      if (saldo.aviso) {
        return NextResponse.json(errorResponse(saldo.aviso), { status: 400 });
      }
      if (saldo.saldo < anticipoPedido) {
        return NextResponse.json(
          errorResponse(
            `El cliente tiene Gs. ${Math.round(saldo.saldo).toLocaleString("es-PY")} de anticipo disponible.`
          ),
          { status: 409 }
        );
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
      anticipoAplicado: anticipoPedido > 0 ? anticipoPedido : null,
      // Depósito del que sale la mercadería: de ahí se descuenta el stock y
      // de ahí salió el precio que Caja mostró.
      ubicacionId:
        typeof o.ubicacion_id === "string" && o.ubicacion_id.trim() ? o.ubicacion_id.trim() : null,
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

    // ── Descontar el anticipo usado ───────────────────────────────────────
    //
    //   Va DESPUÉS de que la venta exista, y no antes, a propósito: si se
    //   descontara primero y la venta fallara (falta de stock, por ejemplo),
    //   el cliente se quedaría sin su plata y sin mercadería, que es el peor
    //   de los dos errores posibles.
    //
    //   La contracara: si la venta sale bien y este descuento falla, el
    //   anticipo queda figurando como disponible aunque ya se usó. Por eso no
    //   se loguea y listo — queda registrado en modificaciones
    //   administrativas, que es donde alguien lo va a ver, con el número de
    //   la venta y el monto para poder corregirlo a mano.
    let anticipoNumeros: string[] = [];
    if (anticipoPedido > 0 && clienteId) {
      try {
        const sbAnt = await createServiceRoleClientForEmpresa(auth.empresa_id);
        const res = await consumirAnticipos(
          sbAnt,
          auth.empresa_id,
          exigirSucursal(auth.sucursal_id),
          clienteId,
          anticipoPedido,
          ventaId
        );
        anticipoNumeros = res.numeros;
        if (!res.ok) {
          console.error("[ventas/create] el anticipo no se descontó completo", {
            ventaId,
            numeroControl,
            pedido: anticipoPedido,
            aplicado: res.aplicado,
            error: res.error,
          });
          await registrarModificacionAdministrativa(sbAnt, auth.empresa_id, {
            entidad: "caja",
            entidad_id: ventaId,
            referencia: numeroControl,
            accion: "configurar",
            detalle:
              `La venta se cobró usando Gs. ${anticipoPedido.toLocaleString("es-PY")} de anticipo, ` +
              `pero solo se pudo descontar Gs. ${Math.round(res.aplicado).toLocaleString("es-PY")}. ` +
              "Revisar el saldo del cliente a mano.",
            motivo: res.error,
            usuario_id: auth.usuarioCatalogId ?? auth.user?.id ?? null,
            usuario_nombre: firma.nombre,
            es_admin: false,
            sucursal_id: auth.sucursal_id ?? null,
          });
        }
      } catch (e) {
        console.error("[ventas/create] excepción descontando el anticipo", e);
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
      } else if (totalDeclarado - anticipoPedido > 0) {
        // Si el anticipo cubrió el total, hoy no se cobró nada: no hay cobro
        // que registrar (y un cobro de 0 solo ensucia la conciliación).
        const pd = (o.pago_detalle ?? null) as Record<string, unknown> | null;
        await insertVentaPagoDetalle(schema, auth.empresa_id, ventaId, {
          metodo_pago: metodoPago,
          entidad_bancaria_id: pd?.entidad_bancaria_id ? String(pd.entidad_bancaria_id) : null,
          entidad_nombre_snapshot: str(pd?.entidad_nombre_snapshot),
          // Lo que se cobró HOY: si parte la puso un anticipo, esa parte ya
          // se cobró en su día y no se vuelve a registrar como ingreso.
          monto: totalDeclarado - anticipoPedido,
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
    //
    // Se renueva la cartera de ESTA sucursal (script 64). Una venta en Casa
    // Central no tiene por qué sostenerle la cartera al vendedor de la otra
    // sucursal: cada una tiene su propio plazo corriendo, que es justamente
    // lo que significa diferenciarla.
    if (clienteId) {
      try {
        const sbCartera = await createServiceRoleClientForEmpresa(auth.empresa_id);
        const upd = await sbCartera
          .from("cliente_cartera")
          .update({ cartera_desde: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("empresa_id", auth.empresa_id)
          .eq("cliente_id", clienteId)
          .eq("sucursal_id", exigirSucursal(auth.sucursal_id))
          // Solo si tiene vendedor: sin dueño, la cartera no significa nada.
          .not("vendedor_usuario_id", "is", null);
        if (upd.error && !/cliente_cartera/.test(upd.error.message ?? "")) {
          console.warn("[ventas/create] cartera:", upd.error.message);
        }
      } catch (e) {
        console.warn("[ventas/create] cartera:", e instanceof Error ? e.message : e);
      }
    }

    // ── La categoría del cliente, por lo que lleva comprado este mes ───────
    //
    // Con esta venta el cliente puede haber cruzado el monto que lo pasa a la
    // categoría siguiente, y eso tiene que valer para la próxima compra sin que
    // nadie corra nada a mano.
    //
    // SOLO ESTE CLIENTE: recorrer el padrón entero después de cada venta sería
    // absurdo. El DESCENSO no puede salir de acá —el que dejó de comprar no
    // dispara ninguna venta— y queda para la pasada de fin de mes
    // (/api/clientes/categorias/recalcular).
    //
    // Best-effort y al final, igual que la cartera: la venta ya está cerrada y
    // no se cae porque no se haya podido mover una categoría. Si falta el
    // script 55, o nadie cargó los montos mínimos, no hace nada.
    if (clienteId) {
      try {
        const schemaCat = await fetchDataSchemaForEmpresaId(auth.empresa_id);
        await recalcularCategorias(
          schemaCat,
          auth.empresa_id,
          auth.sucursal_id ?? "",
          periodoPy(),
          { soloCliente: clienteId, usuarioNombre: "Automático por venta" }
        );
      } catch (e) {
        console.warn("[ventas/create] categoria cliente:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(successResponse({
      venta,
      nota_remision_numero: notaRemisionNumero,
      // Puente Venta → Factura ERP (SIFEN). El front usa `factura.id` para
      // redirigir al detalle /facturas/[id] donde vive el panel SIFEN.
      factura: facturaId ? { id: facturaId, numero_factura: numeroFactura } : null,
      factura_warning: facturaWarning ?? null,
      // Para el ticket: cuánto puso el anticipo y de qué anticipos salió.
      anticipo: anticipoPedido > 0
        ? { aplicado: anticipoPedido, numeros: anticipoNumeros, a_pagar: totalDeclarado - anticipoPedido }
        : null,
    }));
  } catch (err) {
    // Falta de stock sin autorizar: 409 con el detalle de faltantes para que la UI
    // muestre el modal de confirmación y reintente con permitir_sin_stock=true.
    if (err instanceof StockInsuficienteError) {
      const lista = err.faltantes
        .map((f) => `${f.nombre} (hay ${f.stock_actual}, pedís ${f.solicitado})`)
        .join("; ");
      return NextResponse.json(
        {
          ...errorResponse(`No hay stock para facturar: ${lista}. Ajustá la cantidad o cargá el stock antes de vender.`),
          faltantes: err.faltantes,
        },
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
