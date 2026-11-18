import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { tieneFacultad } from "@/lib/perfiles/server/facultades-usuario";
import { aplicarAjuste, cotizacionVentaUsd } from "@/lib/precios/server/precio-para-cliente";
import { precioListaGs } from "@/lib/precios/ficha";

/**
 * GET /api/productos/[id]/historial — todo lo que le pasó a un producto
 * (pedido del cliente): compras, transferencias, remisiones, movimientos de
 * stock (con las anulaciones), cambios de precio, a quién se le vendió y el
 * precio para cada tipo de cliente.
 *
 * Cada parte va en su propia consulta y si una falla (una tabla que esta base
 * no tiene) se devuelve vacía: el resto del historial tiene que salir igual.
 *
 * Los costos y precios de compra solo van para quien puede ver costos.
 */
export const dynamic = "force-dynamic";

type Fila = Record<string, unknown>;
const t = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v));
const n = (v: unknown) => Number(v) || 0;

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sb = ctx.supabase;
    const emp = ctx.auth.empresa_id;
    const verCostos = await tieneFacultad(sb, ctx.auth, "ver_costos");

    const pq = await sb.from("productos").select("*").eq("empresa_id", emp).eq("id", id).maybeSingle();
    if (pq.error) throw new Error(pq.error.message);
    if (!pq.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const prod = pq.data as Fila;

    const leer = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Fila[]> => {
      try {
        const r = await q;
        return r.error ? [] : ((r.data ?? []) as Fila[]);
      } catch {
        return [];
      }
    };

    const [compras, movs, precios, ventasIt, rubros, excepciones, trItemsO, trItemsD, remItems, tc] = await Promise.all([
      leer(sb.from("compras").select("*").eq("empresa_id", emp).eq("producto_id", id).order("fecha", { ascending: false }).limit(60)),
      leer(sb.from("movimientos_inventario")
        .select("id, tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre")
        .eq("empresa_id", emp).eq("producto_id", id).order("fecha", { ascending: false }).limit(150)),
      leer(sb.from("precios_historial")
        .select("precio_anterior, precio_nuevo, modo, valor, usuario_nombre, creado_at")
        .eq("empresa_id", emp).eq("producto_id", id).order("creado_at", { ascending: false }).limit(60)),
      leer(sb.from("ventas_items")
        .select("venta_id, cantidad, precio_venta, precio_venta_original, total_linea")
        .eq("empresa_id", emp).eq("producto_id", id).order("id", { ascending: false }).limit(200)),
      leer(sb.from("categorias_cliente").select("id, nombre, ajuste_pct, orden, activa").eq("empresa_id", emp)),
      leer(sb.from("precios_por_categoria").select("categoria_id, precio").eq("empresa_id", emp).eq("producto_id", id)),
      leer(sb.from("transferencias_inventario_items")
        .select("transferencia_id, cantidad_solicitada, cantidad_despachada, cantidad_recibida, costo_unitario_transferencia")
        .eq("empresa_id", emp).eq("producto_origen_id", id).limit(100)),
      leer(sb.from("transferencias_inventario_items")
        .select("transferencia_id, cantidad_solicitada, cantidad_despachada, cantidad_recibida, costo_unitario_transferencia")
        .eq("empresa_id", emp).eq("producto_destino_id", id).limit(100)),
      leer(sb.from("notas_remision_items").select("nota_remision_id, cantidad").eq("producto_id", id).limit(100)),
      cotizacionVentaUsd(sb, emp).catch(() => null),
    ]);

    // ── Precio para cada tipo de cliente ────────────────────────────────────
    const lista = precioListaGs(prod as { precio_venta?: number; precio_usd?: number }, tc);
    const excPorRubro = new Map(excepciones.map((e) => [String(e.categoria_id), n(e.precio)]));
    const preciosCliente = [
      { tipo: "Lista (sin rubro)", ajuste_pct: null as number | null, precio: lista, fuente: "lista" },
      ...rubros
        .filter((r) => r.activa !== false)
        .sort((a, b) => n(a.orden) - n(b.orden))
        .map((r) => {
          const exc = excPorRubro.get(String(r.id));
          const pct = r.ajuste_pct == null ? null : Number(r.ajuste_pct);
          return exc && exc > 0
            ? { tipo: String(r.nombre), ajuste_pct: pct, precio: exc, fuente: "precio_especial" }
            : { tipo: String(r.nombre), ajuste_pct: pct, precio: aplicarAjuste(lista, pct), fuente: pct ? "ajuste" : "lista" };
        }),
    ];

    // ── Compras: lo que se tipeó al comprar, en la moneda de la compra ──────
    const comprasOut = compras.map((c) => ({
      fecha: t(c.fecha_factura) ?? t(c.fecha),
      numero_compra: t(c.numero_control),
      numero_factura: t(c.numero_factura),
      proveedor: t(c.proveedor_nombre),
      cantidad: n(c.cantidad),
      moneda: t(c.moneda) ?? "PYG",
      tipo_cambio: c.tipo_cambio == null ? null : n(c.tipo_cambio),
      estado: t(c.estado),
      anulacion_motivo: t(c.anulacion_motivo),
      usuario: t(c.usuario_nombre),
      ...(verCostos ? {
        costo_tipeado: c.costo_unitario_original == null ? null : n(c.costo_unitario_original),
        costo_gs: n(c.costo_unitario),
        // En dólares: lo tipeado si la compra fue en dólares; si fue en
        // guaraníes, solo cuando quedó guardado el cambio del día (las
        // compras migradas tienen 1, que no es un cambio).
        costo_usd: String(c.moneda ?? "") === "USD"
          ? n(c.costo_unitario_original)
          : (n(c.tipo_cambio) > 100 ? n(c.costo_unitario) / n(c.tipo_cambio) : null),
        precio_venta: c.precio_venta == null ? null : n(c.precio_venta),
        precio_venta_usd: c.precio_venta_usd == null ? null : n(c.precio_venta_usd),
      } : {}),
    }));

    // ── Ventas: a quién se le vendió (las últimas) ──────────────────────────
    const ventaIds = [...new Set(ventasIt.map((v) => String(v.venta_id)))].slice(0, 100);
    const ventasCab = ventaIds.length
      ? await leer(sb.from("ventas")
          .select("id, numero_control, fecha, estado, cliente_id, tipo_venta, usuario_nombre, vendedor_nombre")
          .eq("empresa_id", emp).in("id", ventaIds))
      : [];
    const cliIds = [...new Set(ventasCab.map((v) => t(v.cliente_id)).filter(Boolean) as string[])];
    const clientes = cliIds.length
      ? await leer(sb.from("clientes").select("*").eq("empresa_id", emp).in("id", cliIds))
      : [];
    // El mismo orden de nombres que el listado de ventas.
    const nomCli = new Map(clientes.map((c) => [
      String(c.id),
      t(c.nombre_facturacion) ?? t(c.empresa) ?? t(c.nombre_contacto) ?? t(c.nombre) ?? "Cliente",
    ]));
    const cabPorId = new Map(ventasCab.map((v) => [String(v.id), v]));
    const ventasOut = ventasIt
      .map((it) => {
        const v = cabPorId.get(String(it.venta_id));
        if (!v) return null;
        return {
          fecha: t(v.fecha),
          numero_venta: t(v.numero_control),
          cliente: v.cliente_id ? nomCli.get(String(v.cliente_id)) ?? "Cliente" : "Consumidor final",
          cantidad: n(it.cantidad),
          precio: n(it.precio_venta),
          precio_lista: n(it.precio_venta_original),
          total: n(it.total_linea),
          condicion: v.tipo_venta === "CREDITO" ? "Crédito" : "Contado",
          vendedor: t(v.vendedor_nombre) ?? t(v.usuario_nombre),
          anulada: v.estado === "anulada",
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b!.fecha).localeCompare(String(a!.fecha)))
      .slice(0, 50);

    // ── Transferencias entre sucursales ─────────────────────────────────────
    const trItems: Fila[] = [...trItemsO.map((i) => ({ ...i, sentido: "sale" })), ...trItemsD.map((i) => ({ ...i, sentido: "entra" }))];
    const trIds = [...new Set(trItems.map((i) => String(i.transferencia_id)))];
    const trCab = trIds.length
      ? await leer(sb.from("transferencias_inventario")
          .select("id, numero, numero_remision, estado, sucursal_origen_id, sucursal_destino_id, solicitada_por, despachada_por, recibida_por, solicitada_at, despachada_at, recibida_at")
          .eq("empresa_id", emp).in("id", trIds))
      : [];
    const sucIds = [...new Set(trCab.flatMap((c) => [t(c.sucursal_origen_id), t(c.sucursal_destino_id)]).filter(Boolean) as string[])];
    const usrIds = [...new Set(trCab.flatMap((c) => [t(c.solicitada_por), t(c.despachada_por), t(c.recibida_por)]).filter(Boolean) as string[])];
    const [sucs, usrs] = await Promise.all([
      sucIds.length ? leer(sb.from("sucursales").select("id, nombre").in("id", sucIds)) : Promise.resolve([] as Fila[]),
      usrIds.length ? leer(sb.from("usuarios").select("id, auth_user_id, nombre, email").or(
        `id.in.(${usrIds.join(",")}),auth_user_id.in.(${usrIds.join(",")})`
      )) : Promise.resolve([] as Fila[]),
    ]);
    const nomSuc = new Map(sucs.map((s) => [String(s.id), String(s.nombre ?? "")]));
    const nomUsr = new Map<string, string>();
    for (const u of usrs) {
      const nom = t(u.nombre) ?? t(u.email) ?? "";
      if (u.id) nomUsr.set(String(u.id), nom);
      if (u.auth_user_id) nomUsr.set(String(u.auth_user_id), nom);
    }
    const trCabPorId = new Map(trCab.map((c) => [String(c.id), c]));
    const transferencias = trItems
      .map((i) => {
        const c = trCabPorId.get(String(i.transferencia_id));
        if (!c) return null;
        const quien = (k: string) => (c[k] ? nomUsr.get(String(c[k])) ?? null : null);
        return {
          fecha: t(c.recibida_at) ?? t(c.despachada_at) ?? t(c.solicitada_at),
          numero: t(c.numero_remision) ?? t(c.numero),
          estado: t(c.estado),
          de: nomSuc.get(String(c.sucursal_origen_id)) ?? "—",
          a: nomSuc.get(String(c.sucursal_destino_id)) ?? "—",
          sentido: i.sentido,
          cantidad: n(i.cantidad_recibida) || n(i.cantidad_despachada) || n(i.cantidad_solicitada),
          pidio: quien("solicitada_por"),
          despacho: quien("despachada_por"),
          recibio: quien("recibida_por"),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b!.fecha).localeCompare(String(a!.fecha)));

    // ── Notas de remisión entre depósitos ───────────────────────────────────
    const remIds = [...new Set(remItems.map((r) => String(r.nota_remision_id)))];
    const remCab = remIds.length
      ? await leer(sb.from("notas_remision")
          .select("id, numero, fecha, estado, ubicacion_origen_id, ubicacion_destino_id, motivo, emisor")
          .eq("empresa_id", emp).in("id", remIds))
      : [];
    const ubiIds = [...new Set(remCab.flatMap((c) => [t(c.ubicacion_origen_id), t(c.ubicacion_destino_id)]).filter(Boolean) as string[])];
    const ubis = ubiIds.length ? await leer(sb.from("ubicaciones").select("id, nombre").in("id", ubiIds)) : [];
    const nomUbi = new Map(ubis.map((u) => [String(u.id), String(u.nombre ?? "")]));
    const remCabPorId = new Map(remCab.map((c) => [String(c.id), c]));
    const remisiones = remItems
      .map((r) => {
        const c = remCabPorId.get(String(r.nota_remision_id));
        if (!c) return null;
        return {
          fecha: t(c.fecha),
          numero: t(c.numero),
          estado: t(c.estado),
          de: nomUbi.get(String(c.ubicacion_origen_id)) ?? "—",
          a: nomUbi.get(String(c.ubicacion_destino_id)) ?? "—",
          cantidad: n(r.cantidad),
          motivo: t(c.motivo),
          quien: t(c.emisor),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(b!.fecha).localeCompare(String(a!.fecha)));

    // ── Movimientos de stock (kardex), con las anulaciones ──────────────────
    const movimientos = movs.map((m) => ({
      fecha: t(m.fecha),
      tipo: t(m.tipo),
      origen: t(m.origen),
      cantidad: n(m.cantidad),
      referencia: t(m.referencia),
      usuario: t(m.usuario_nombre),
      ...(verCostos ? { costo_unitario: n(m.costo_unitario) } : {}),
    }));

    // Cambios de precio: los del estudio de precios y los que dejó cada compra.
    const cambiosPrecio = [
      ...precios.map((p) => ({
        fecha: t(p.creado_at), anterior: n(p.precio_anterior), nuevo: n(p.precio_nuevo),
        como: p.modo === "manual" ? "A mano" : "Estudio de precios", usuario: t(p.usuario_nombre),
      })),
      ...compras
        .filter((c) => c.precio_venta != null && n(c.precio_venta) > 0 && c.estado !== "anulada")
        .map((c) => ({
          fecha: t(c.fecha_factura) ?? t(c.fecha), anterior: null as number | null, nuevo: n(c.precio_venta),
          como: `Compra ${t(c.numero_control) ?? ""}`.trim(), usuario: t(c.usuario_nombre),
        })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    const ultimaCompra = comprasOut.find((c) => c.estado !== "anulada") ?? null;
    const ultimaVenta = ventasOut.find((v) => v && !v.anulada) ?? null;

    return NextResponse.json(successResponse({
      ver_costos: verCostos,
      cotizacion_usd: tc,
      precio_lista: lista,
      precio_usd: prod.precio_usd == null ? null : n(prod.precio_usd),
      precios_cliente: preciosCliente,
      ultimo_proveedor: ultimaCompra?.proveedor ?? null,
      ultima_compra: ultimaCompra,
      ultimo_cliente: ultimaVenta?.cliente ?? null,
      compras: comprasOut,
      ventas: ventasOut,
      transferencias,
      remisiones,
      movimientos,
      cambios_precio: cambiosPrecio,
    }));
  } catch (err) {
    console.error("[/api/productos/[id]/historial]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo armar el historial del producto."), { status: 500 });
  }
}
