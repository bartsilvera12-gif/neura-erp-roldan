import { NextRequest, NextResponse } from "next/server";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta, TipoIvaVenta, TipoPrecioVenta } from "@/lib/ventas/types";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

interface VentaRow {
  id: string;
  empresa_id: string;
  numero_control: string;
  moneda: string;
  tipo_cambio: number | string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  tipo_venta: string;
  plazo_dias: number | null;
  fecha: string;
}

interface VentaItemRow {
  venta_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta_original: number | string;
  precio_venta: number | string;
  tipo_iva: string;
  tipo_precio?: string;
  subtotal: number | string;
  monto_iva: number | string;
  total_linea: number | string;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function mapItems(rows: VentaItemRow[]): LineaVenta[] {
  return rows.map((r) => ({
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    sku: r.sku,
    cantidad: num(r.cantidad),
    precio_venta_original: num(r.precio_venta_original),
    precio_venta: num(r.precio_venta),
    tipo_iva: r.tipo_iva as TipoIvaVenta,
    tipo_precio: (r.tipo_precio === "mayorista" || r.tipo_precio === "distribuidor" || r.tipo_precio === "costo" ? r.tipo_precio : "minorista") as TipoPrecioVenta,
    subtotal: num(r.subtotal),
    monto_iva: num(r.monto_iva),
    total_linea: num(r.total_linea),
  }));
}

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";

/**
 * GET /api/ventas — listado vía PostgREST (compatible Hostinger sin pool).
 *
 * Parámetros opcionales (punto 2.1):
 *   desde, hasta — fechas YYYY-MM-DD en hora de Paraguay, ambas inclusive.
 *   limite       — cuántas traer (máx. 2000). Por defecto 500.
 *
 * POR QUÉ EL FILTRO DE FECHA VA EN EL SERVIDOR
 *   El listado trae las últimas 500 ventas y filtra en el navegador. Buscar una
 *   venta de hace tres meses con ese esquema no la encuentra nunca: nunca llegó
 *   al navegador. Con el rango aplicado en la consulta, las 500 son las de ESE
 *   período y la venta vieja aparece.
 */
/**
 * Trae filas por una lista de ids, en tandas.
 *
 * ── POR QUÉ NO SE RECORRE LA TABLA ENTERA ─────────────────────────────────
 *   Antes, para resolver los nombres de los clientes de las ventas listadas,
 *   esta ruta paginaba TODA la tabla de clientes de a 1.000 y filtraba en
 *   memoria. Con 6 clientes de prueba era un pedido. Al migrar los 21.344
 *   clientes reales pasaron a ser 22 pedidos encadenados — y lo mismo con
 *   facturas y con los estados de SIFEN. El Historial de ventas se quedaba
 *   en "Cargando…" para siempre.
 *
 * ── POR QUÉ TAMPOCO UN `in()` GIGANTE ─────────────────────────────────────
 *   Que era el problema que la paginación venía a esquivar: con cientos de
 *   UUIDs la URL se pasa de los 5 KB y el gateway la rechaza, encima en
 *   silencio.
 *
 *   La salida es pedir SOLO los ids que hacen falta, de a 100: la URL queda
 *   en unos 4 KB y la cantidad de pedidos depende de las ventas listadas, no
 *   del tamaño del padrón de clientes.
 */
async function porIds<T>(
  consultar: (ids: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  ids: string[],
  tanda = 100
): Promise<{ filas: T[]; error: string | null }> {
  const filas: T[] = [];
  for (let i = 0; i < ids.length; i += tanda) {
    const r = await consultar(ids.slice(i, i + tanda));
    if (r.error) return { filas, error: r.error.message ?? "error" };
    filas.push(...((r.data ?? []) as T[]));
  }
  return { filas, error: null };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sp = new URL(request.url).searchParams;

    const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
    const limite = Math.min(2000, Math.max(1, parseInt(sp.get("limite") ?? "500", 10) || 500));

    // Se arma de nuevo por página: el builder acumula los order si se reusa.
    const armar = () => {
      let q = ctx.supabase
        .from("ventas")
        .select(
          "id, empresa_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, fecha, genera_nota_remision, nota_remision_numero, estado, anulada_at, anulacion_motivo, factura_id, cliente_id, origen, usuario_nombre, vendedor_nombre"
        )
        .eq("empresa_id", empresaId)
        .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id));

      // El día "hasta" entra entero: quien filtra del 1 al 31 espera que el 31
      // esté incluido, no que corte a la medianoche del 30.
      if (desde) q = q.gte("fecha", `${desde}T00:00:00${OFFSET_PY}`);
      if (hasta) q = q.lte("fecha", `${hasta}T23:59:59.999${OFFSET_PY}`);
      return q;
    };

    // Hasta `limite` filas de a páginas: `.limit(2000)` devolvía 1000 (el
    // corte de PostgREST) y el Historial, que pide 2000 y avisa al llegar al
    // tope, mostraba un mes de 1.500 ventas con 1.000 y sin aviso.
    const ventasQ = {
      data: (
        await traerTodas<Record<string, unknown>>(
          (d, h) => armar().order("fecha", { ascending: false }).order("id", { ascending: true }).range(d, h),
          { tope: limite, tam: Math.min(1000, limite) }
        )
      ).slice(0, limite),
    };

    // Cargar nombre del cliente para las ventas asociadas a un cliente.
    // Batch por eficiencia; si el join falla se degrada silenciosamente
    // (el UI muestra "Consumidor final" cuando no hay cliente).
    const clienteIds = [
      ...new Set(
        ((ventasQ.data ?? []) as Array<{ cliente_id?: string | null }>)
          .map((v) => v.cliente_id)
          .filter((v): v is string => !!v)
      ),
    ];
    const clienteNombreByIdMap = new Map<string, string>();
    // Nombre comercial / sucursal / local del cliente (para diferenciar sucursales
    // en la columna Cliente de la lista). Opcional: si el tenant no tiene la columna,
    // el listado degrada sin la sucursal.
    const clienteComercialByIdMap = new Map<string, string>();
    if (clienteIds.length > 0) {
      type ClienteNombreRow = {
        id: string;
        empresa?: string | null;
        nombre_contacto?: string | null;
        nombre?: string | null;
        nombre_facturacion?: string | null;
        nombre_comercial?: string | null;
      };
      // Solo los clientes de las ventas listadas, de a 100 por pedido.
      let colsCliente = "id, empresa, nombre_contacto, nombre, nombre_facturacion, nombre_comercial";
      let resCli = await porIds<ClienteNombreRow>(
        (ids) => ctx.supabase.from("clientes").select(colsCliente).eq("empresa_id", empresaId).in("id", ids),
        clienteIds
      );
      // Un tenant puede no tener todavía las columnas más nuevas (PostgREST
      // responde 42703): se baja al set que existe desde el schema inicial.
      if (resCli.error && colsCliente.includes("nombre_comercial")) {
        colsCliente = "id, empresa, nombre_contacto, nombre, nombre_facturacion";
        resCli = await porIds<ClienteNombreRow>(
          (ids) => ctx.supabase.from("clientes").select(colsCliente).eq("empresa_id", empresaId).in("id", ids),
          clienteIds
        );
      }
      if (resCli.error) {
        colsCliente = "id, empresa, nombre_contacto";
        resCli = await porIds<ClienteNombreRow>(
          (ids) => ctx.supabase.from("clientes").select(colsCliente).eq("empresa_id", empresaId).in("id", ids),
          clienteIds
        );
      }
      if (resCli.error) {
        // No es fatal: el UI degrada al nombre guardado en la factura.
        console.error("[/api/ventas GET] clientes:", resCli.error);
      }
      for (const row of resCli.filas) {
        const disp =
          (row.nombre_facturacion?.trim() || "") ||
          (row.empresa?.trim() || "") ||
          (row.nombre_contacto?.trim() || "") ||
          (row.nombre?.trim() || "");
        if (disp) clienteNombreByIdMap.set(row.id, disp);
        const comercial = row.nombre_comercial?.trim() || "";
        if (comercial) clienteComercialByIdMap.set(row.id, comercial);
      }
    }

    // Cargar numero_factura para las ventas que ya tienen factura ERP. Un batch
    // por eficiencia; si el join falla, degradamos a solo id (la UI muestra "Facturada").
    const facturaIds = [
      ...new Set(
        ((ventasQ.data ?? []) as Array<{ factura_id?: string | null }>)
          .map((v) => v.factura_id)
          .filter((v): v is string => !!v)
      ),
    ];
    const facturaByIdMap = new Map<string, string>();
    const feEstadoByFacturaMap = new Map<string, string>();
    // Razón social congelada al facturar. Sirve de respaldo para la columna
    // Cliente cuando la ficha ya no se puede leer (o el cliente fue eliminado).
    const razonSocialByFacturaMap = new Map<string, string>();
    if (facturaIds.length > 0) {
      // Mismo criterio que los clientes: solo las facturas de estas ventas,
      // de a 100. Paginar la tabla entera de facturas hacía que el listado
      // tardara en función de cuántas facturas tiene la empresa y no de
      // cuántas ventas se están mirando.
      const resFac = await porIds<{
        id: string;
        numero_factura?: string | null;
        cliente_razon_social?: string | null;
      }>(
        (ids) =>
          ctx.supabase
            .from("facturas")
            .select("id, numero_factura, cliente_razon_social")
            .eq("empresa_id", empresaId)
            .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
            .in("id", ids),
        facturaIds
      );
      if (resFac.error) throw new Error(resFac.error);
      for (const row of resFac.filas) {
        if (row.numero_factura) facturaByIdMap.set(row.id, row.numero_factura);
        const rs = row.cliente_razon_social?.trim();
        if (rs) razonSocialByFacturaMap.set(row.id, rs);
      }

      // Estado SIFEN por factura — el UI usa este dato para decidir si mostrar
      // el botón "Anular" cuando la factura quedó en error_envio/rechazado.
      const resFe = await porIds<{ factura_id: string; estado_sifen?: string | null }>(
        (ids) =>
          ctx.supabase
            .from("factura_electronica")
            .select("factura_id, estado_sifen")
            .eq("empresa_id", empresaId)
            .eq("sucursal_id", exigirSucursal(ctx.auth.sucursal_id))
            .in("factura_id", ids),
        facturaIds
      );
      // No es fatal: sin el estado SIFEN el UI degrada bien.
      for (const row of resFe.filas) {
        if (row.estado_sifen) feEstadoByFacturaMap.set(row.factura_id, row.estado_sifen);
      }
    }

    const ventasRows = (ventasQ.data ?? []) as unknown as VentaRow[];

    // Ítems de la empresa, PAGINADO. Antes se traían sin límite: PostgREST corta
    // en 1000 filas por defecto, así que al superar las 1000 líneas (histórico
    // creciente) las ventas más nuevas aparecían "sin líneas cargadas" aunque sus
    // ítems existieran. El `.range()` en bucle trae todo sin depender de ese tope.
    //
    // Nota: NO se filtra con `.in("venta_id", [ids])` — con cientos de UUIDs la
    // URL de PostgREST se dispara (~7 KB con 171 ventas) y el gateway la rechaza,
    // rompiendo TODO el listado. Se filtran en memoria contra las ventas cargadas.
    // Los ítems de ESTAS ventas, de a 100 ventas por pedido.
    //
    // Antes se paginaba la tabla `ventas_items` completa y se filtraba en
    // memoria, para esquivar dos trampas reales: el tope de 1.000 filas de
    // PostgREST (que dejaba ventas "sin líneas cargadas") y la URL gigante de
    // un `in()` con cientos de UUIDs (que el gateway rechaza, en silencio).
    //
    // El costo escondido era que el tiempo dependía del tamaño del histórico y
    // no de lo que se está mirando: al migrar las 187.785 líneas reales
    // pasaron a ser 188 pedidos encadenados y el Historial de ventas se
    // quedaba cargando para siempre. Pedir por tandas de ids evita las dos
    // trampas y además no crece con el histórico.
    const itemsRows: VentaItemRow[] = [];
    {
      const res = await porIds<VentaItemRow>(
        (ids) =>
          ctx.supabase
            .from("ventas_items")
            .select(
              "venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original, precio_venta, tipo_iva, tipo_precio, subtotal, monto_iva, total_linea"
            )
            .eq("empresa_id", empresaId)
            .in("venta_id", ids),
        ventasRows.map((v) => v.id)
      );
      if (res.error) throw new Error(res.error);
      itemsRows.push(...res.filas);
    }

    const byVenta = new Map<string, VentaItemRow[]>();
    for (const row of itemsRows) {
      const list = byVenta.get(row.venta_id) ?? [];
      list.push(row);
      byVenta.set(row.venta_id, list);
    }

    // Banderas para la fila del listado: si la venta fue editada y si tiene
    // devoluciones. Son dos consultas de ids sobre las ventas ya cargadas, no
    // el detalle: ese se pide al abrir la venta (/api/ventas/[id]/historial).
    const idsLista = ventasRows.map((v) => v.id);
    const editadas = new Set<string>();
    const conDevolucion = new Set<string>();
    if (idsLista.length) {
      // También por tandas: con 2.000 ventas, un solo `in()` arma una URL de
      // unos 74 KB que el gateway rechaza.
      const [edQ, devQ] = await Promise.all([
        porIds<{ venta_id: string }>(
          (ids) => ctx.supabase.from("ventas_ediciones").select("venta_id").eq("empresa_id", empresaId).in("venta_id", ids),
          idsLista
        ),
        porIds<{ venta_id: string }>(
          (ids) => ctx.supabase.from("devoluciones_venta").select("venta_id").eq("empresa_id", empresaId).in("venta_id", ids),
          idsLista
        ),
      ]);
      // Si todavía no se corrió la migración que crea alguna de las dos, la
      // consulta falla: se ignora y el listado sale sin las banderas, en vez
      // de dejar la pantalla de ventas rota esperando un script.
      for (const r of edQ.filas) editadas.add(r.venta_id);
      for (const r of devQ.filas) conDevolucion.add(r.venta_id);
    }

    const ventas: Venta[] = ventasRows.map((r) => {
      const lineRows = byVenta.get(r.id) ?? [];
      return {
        id: r.id,
        numero_control: r.numero_control,
        items: mapItems(lineRows),
        moneda: r.moneda === "USD" ? "USD" : "GS",
        tipo_cambio: num(r.tipo_cambio),
        subtotal: num(r.subtotal),
        monto_iva: num(r.monto_iva),
        total: num(r.total),
        tipo_venta: r.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        plazo_dias: r.plazo_dias ?? undefined,
        metodo_pago: (r as unknown as { metodo_pago?: string }).metodo_pago === "tarjeta"
          ? "tarjeta"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "transferencia"
          ? "transferencia"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "efectivo"
          ? "efectivo"
          : undefined,
        genera_nota_remision: (r as unknown as { genera_nota_remision?: boolean }).genera_nota_remision === true,
        nota_remision_numero: (r as unknown as { nota_remision_numero?: string | null }).nota_remision_numero ?? null,
        fecha: r.fecha,
        // Se seleccionaban pero no se copiaban al objeto de respuesta, así que
        // la columna Vendedor del historial salía siempre vacía aunque la
        // venta tuviera el vendedor guardado.
        usuario_nombre: (r as unknown as { usuario_nombre?: string | null }).usuario_nombre ?? null,
        editada: editadas.has(r.id),
        tiene_devolucion: conDevolucion.has(r.id),
        vendedor_nombre: (r as unknown as { vendedor_nombre?: string | null }).vendedor_nombre ?? null,
        estado: ((): "pendiente" | "completada" | "anulada" => {
          const e = (r as unknown as { estado?: string }).estado;
          return e === "anulada" || e === "pendiente" ? e : "completada";
        })(),
        anulada_at: (r as unknown as { anulada_at?: string | null }).anulada_at ?? null,
        anulacion_motivo: (r as unknown as { anulacion_motivo?: string | null }).anulacion_motivo ?? null,
        factura_id: ((r as unknown as { factura_id?: string | null }).factura_id) ?? null,
        // Unidad de negocio: consignataria = origen 'consignacion'; el resto es nutrición.
        origen: ((r as unknown as { origen?: string | null }).origen) ?? null,
        numero_factura: (() => {
          const fid = (r as unknown as { factura_id?: string | null }).factura_id;
          return fid ? facturaByIdMap.get(fid) ?? null : null;
        })(),
        factura_estado_sifen: (() => {
          const fid = (r as unknown as { factura_id?: string | null }).factura_id;
          return fid ? feEstadoByFacturaMap.get(fid) ?? null : null;
        })(),
        cliente_id: ((r as unknown as { cliente_id?: string | null }).cliente_id) ?? null,
        cliente_nombre: (() => {
          const cid = (r as unknown as { cliente_id?: string | null }).cliente_id;
          const fid = (r as unknown as { factura_id?: string | null }).factura_id;
          const porFicha = cid ? clienteNombreByIdMap.get(cid) ?? null : null;
          const porFactura = fid ? razonSocialByFacturaMap.get(fid) ?? null : null;
          return porFicha ?? porFactura;
        })(),
        cliente_sucursal: (() => {
          const cid = (r as unknown as { cliente_id?: string | null }).cliente_id;
          return cid ? clienteComercialByIdMap.get(cid) ?? null : null;
        })(),
      };
    });

    return NextResponse.json(successResponse({ ventas }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
