import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearPresupuesto, type PresupuestoItemInput } from "@/lib/presupuestos/server/presupuestos-pg";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { isAdmin } from "@/lib/middleware/auth";
import { tieneFacultad } from "@/lib/perfiles/server/facultades-usuario";
import { faltantesDelPresupuesto, textoFaltantes } from "@/lib/presupuestos/faltantes";
import { asegurarClienteDelPresupuesto } from "@/lib/presupuestos/server/cliente-del-presupuesto";
import { faltantesDeStock, mensajeFaltantes } from "@/lib/presupuestos/server/stock-presupuesto";
import {
  conCamposScript38,
  leerPresupuestosConFallback,
} from "@/lib/presupuestos/server/presupuestos-select";

function asIva(v: unknown): "EXENTA" | "5%" | "10%" {
  return v === "EXENTA" || v === "5%" || v === "10%" ? v : "10%";
}

function parseItems(raw: unknown): PresupuestoItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PresupuestoItemInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const nombre = String(r.producto_nombre ?? "").trim();
    const cantidad = Number(r.cantidad);
    const precio = Number(r.precio_unitario);
    if (!nombre || !(cantidad > 0) || !(precio >= 0)) return null;
    out.push({
      producto_id: r.producto_id ? String(r.producto_id) : null,
      producto_nombre: nombre,
      sku: r.sku ? String(r.sku) : null,
      cantidad,
      unidad_medida: r.unidad_medida ? String(r.unidad_medida) : null,
      precio_unitario: precio,
      iva_tipo: asIva(r.iva_tipo),
      descuento: Math.max(0, Number(r.descuento) || 0),
    });
  }
  return out;
}

/** GET /api/presupuestos — listado (opcional ?estado=). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const estado = sp.get("estado");
    // Cada vendedor ve sus presupuestos y nada más. El administrador ve todos,
    // y puede filtrar por persona con ?vendedor=.
    const esAdminLista = isAdmin(ctx.auth);
    const propioId = ctx.auth.usuarioCatalogId ?? ctx.auth.user?.id ?? null;
    const vendedorFiltro = esAdminLista ? (sp.get("vendedor") || "").trim() : "";
    // Solo los mandados a la caja y sin cobrar: es la cola del cajero.
    const soloCola = sp.get("cola_caja") === "1";
    const { data, error, script38 } = await leerPresupuestosConFallback<Record<string, unknown>[]>(
      (cols) => {
        let q = ctx.supabase
          .from("presupuestos")
          .select(cols)
          .eq("empresa_id", ctx.auth.empresa_id)
          .order("fecha", { ascending: false })
          .limit(500);
        if (estado) q = q.eq("estado", estado);
        if (vendedorFiltro) q = q.eq("vendedor_usuario_id", vendedorFiltro);
        // La cola de la caja NO se filtra por dueño: la cajera cobra
        // presupuestos que hicieron otros. Con el filtro de "cada vendedor ve
        // los suyos", a la caja no le llegaba ninguno.
        else if (!esAdminLista && propioId && !soloCola) {
          // `or` y no `eq`: los presupuestos viejos no tienen vendedor cargado
          // y son de quien los hizo. Sin esto, el vendedor dejaría de ver todo
          // lo que cargó antes del script 41.
          q = q.or(`vendedor_usuario_id.eq.${propioId},usuario_id.eq.${propioId}`);
        }
        if (soloCola) {
          q = q.eq("estado", "aprobado").not("enviado_a_caja_at", "is", null).is("convertido_venta_id", null);
        }
        return q as unknown as PromiseLike<{
          data: Record<string, unknown>[] | null;
          error: { message: string } | null;
        }>;
      }
    );
    if (error) throw new Error(error.message);
    const presupuestos = (data ?? []).map((r) => conCamposScript38(r, script38));
    return NextResponse.json(successResponse({ presupuestos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[/api/presupuestos GET]", msg);
    // El detalle va al cliente: un "no se pudieron cargar" a secas no le dice
    // nada a nadie, y acá el único que lo ve es gente de la casa.
    return NextResponse.json(
      errorResponse(`No se pudieron cargar los presupuestos. ${msg}`),
      { status: 500 }
    );
  }
}

/** POST /api/presupuestos — crear. NO descuenta stock. */
export async function POST(request: NextRequest) {
  try {
    // Con el rol: hace falta para saber si puede poner el presupuesto a
    // nombre de otra persona.
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const items = parseItems(body.items);
    if (!items) {
      return NextResponse.json(errorResponse("El presupuesto debe tener al menos un ítem válido."), { status: 400 });
    }

    /**
     * ── EL IVA LO FIJA EL PRODUCTO, NO EL VENDEDOR ─────────────────────────
     *
     * El tipo de IVA es un dato fiscal del artículo, no una condición que se
     * negocie en una cotización. Pasar una chapa de 10% a exenta baja el
     * total y hace la oferta más atractiva, pero después la factura sale al
     * 10% igual: queda una diferencia que descubre el cliente al pagar, o el
     * contador al cerrar el mes.
     *
     * Por eso, para quien no es administrador, el `iva_tipo` que llega en el
     * pedido SE IGNORA y se usa el del producto. Esconder el campo en la
     * pantalla no alcanza: sin este guard, el mismo pedido se puede mandar
     * a mano con cualquier valor.
     *
     * Los ítems escritos a mano no tienen producto detrás, así que quedan en
     * 10%, que es el caso normal de la casa.
     */
    if (!isAdmin(ctx.auth)) {
      const idsProducto = [...new Set(items.map((it) => it.producto_id).filter((x): x is string => Boolean(x)))];
      const ivaDelProducto = new Map<string, string>();
      if (idsProducto.length > 0) {
        const { data: filas, error: eIva } = await ctx.supabase
          .from("productos")
          .select("id, tipo_iva")
          .eq("empresa_id", ctx.auth.empresa_id)
          .in("id", idsProducto);
        /* Si la consulta falla no se deja pasar lo que mandó el cliente: se
           cae a 10%, que es lo que el producto tiene en la práctica. Preferir
           el dato del pedido sería justamente el agujero que esto tapa. */
        if (eIva) console.warn("[presupuestos] no se pudo leer el IVA de los productos:", eIva.message);
        for (const f of filas ?? []) {
          const t = String((f as { tipo_iva?: string | null }).tipo_iva ?? "");
          ivaDelProducto.set(String((f as { id: string }).id), t);
        }
      }
      for (const it of items) {
        it.iva_tipo = asIva(it.producto_id ? ivaDelProducto.get(it.producto_id) : undefined);
      }
    }
    const clienteNombre = String(body.cliente_nombre ?? "").trim();
    if (!clienteNombre) {
      return NextResponse.json(errorResponse("El nombre del cliente es obligatorio."), { status: 400 });
    }

    /**
     * QUÉ FALTA PARA QUE ESTO SEA UN PRESUPUESTO FIRME
     *
     * Son los mismos datos que pide el alta de cliente, porque esta ruta DA DE
     * ALTA al cliente cuando se escribe a mano: si acá se pidiera menos, el
     * presupuesto sería la puerta por donde entran las fichas incompletas que
     * el alta de clientes ya no deja pasar.
     *
     * Pero faltar no es motivo para rechazar el pedido. Antes sí lo era, y el
     * resultado fue el contrario del buscado: el que no tenía el RUC del
     * cliente no podía guardar, la cotización salía a mano y no quedaba
     * registrada en ninguna parte. Ahora se guarda como BORRADOR —queda qué se
     * cotizó y a qué precio— y no avanza hasta completar los datos.
     *
     * Solo se mira cuando el cliente NO salió del catálogo: al cotizarle a uno
     * que ya existe no se le vuelven a pedir sus datos.
     */
    /**
     * Cotizar más de lo que hay: solo el administrador.
     *
     * Cotizar sin stock sigue siendo válido (punto 9.1) —en una ferretería lo
     * normal es ofrecer, que el cliente acepte y recién entonces comprar— pero
     * prometer mercadería que no está es asumir una compra y una fecha de
     * entrega, y eso lo decide el que compra.
     *
     * Va antes de crear nada: una cotización rechazada no tiene que dejar
     * media ficha de cliente dada de alta.
     */
    /**
     * Guardado automático mientras se arma (`autoguardado: true`): queda
     * SIEMPRE como borrador, no da de alta al cliente y no frena por stock.
     * Es lo que se estaba escribiendo, no un presupuesto firme; el control de
     * stock y el alta del cliente se hacen cuando se aprieta Guardar.
     */
    const autoguardado = body.autoguardado === true;

    if (!autoguardado && !(await tieneFacultad(ctx.supabase, ctx.auth, "cotizar_sin_stock"))) {
      const faltantes = await faltantesDeStock(
        ctx.supabase,
        ctx.auth.empresa_id,
        ctx.auth.sucursal_id ?? null,
        items.map((it) => ({
          producto_id: it.producto_id ?? null,
          producto_nombre: it.producto_nombre,
          cantidad: it.cantidad,
        }))
      );
      if (faltantes.length > 0) {
        return NextResponse.json(errorResponse(mensajeFaltantes(faltantes)), { status: 403 });
      }
    }

    const faltan = faltantesDelPresupuesto({
      cliente_id: body.cliente_id as string | null | undefined,
      nombre: clienteNombre,
      ruc: body.cliente_ruc as string | null | undefined,
      telefono: body.cliente_telefono as string | null | undefined,
      profesion: body.cliente_profesion as string | null | undefined,
      ciudad: body.cliente_ciudad as string | null | undefined,
    });
    const esBorrador = autoguardado || faltan.length > 0;
    const validezRaw = body.validez_dias;
    const validez =
      validezRaw === null || validezRaw === undefined || String(validezRaw).trim() === ""
        ? null
        : Math.max(0, parseInt(String(validezRaw), 10) || 0) || null;

    // Auto-alta de cliente cuando se escribe a mano (sin seleccionar del catalogo).
    // - Si el RUC coincide con uno existente, se linkea (evita duplicados).
    // - Si no, se crea un nuevo cliente con los datos del presupuesto.
    let clienteId: string | null = body.cliente_id ? String(body.cliente_id) : null;
    const rucInput = body.cliente_ruc ? String(body.cliente_ruc).trim() : "";
    const telInput = body.cliente_telefono ? String(body.cliente_telefono).trim() : "";
    const dirInput = body.cliente_direccion ? String(body.cliente_direccion).trim() : "";
    // Ciudad y profesión también: son obligatorias en el alta, y si el cliente
    // se crea desde acá sin ellas, nace incompleto por la ventana de atrás.
    const ciudadInput = body.cliente_ciudad ? String(body.cliente_ciudad).trim() : "";
    const profInput = body.cliente_profesion ? String(body.cliente_profesion).trim() : "";
    // Un borrador NO da de alta al cliente: justamente le faltan los datos que
    // el alta exige, y crear la ficha a medias es lo que se quería evitar. La
    // ficha nace cuando el borrador se completa, desde la edición.
    if (!clienteId && !esBorrador) {
      clienteId = await asegurarClienteDelPresupuesto(
        ctx.supabase,
        {
          empresaId: ctx.auth.empresa_id,
          userId: ctx.auth.user.id,
          emailCreador:
            (typeof ctx.auth.user?.email === "string" ? ctx.auth.user.email.trim() : "") || null,
        },
        {
          nombre: clienteNombre,
          ruc: rucInput,
          telefono: telInput,
          direccion: dirInput,
          ciudad: ciudadInput,
          profesion: profInput,
          moneda: body.moneda === "USD" ? "USD" : "GS",
        }
      );
    }

    // El teléfono sigue siendo obligatorio para un presupuesto firme —sin forma
    // de contactar al cliente no hay seguimiento, y el seguimiento es la mitad
    // del trabajo— pero su falta lo deja en borrador, no lo rechaza. Ya está
    // contado en `faltan`: esto es solo la defensa para el presupuesto de un
    // cliente del catálogo, donde `faltan` no se mira.
    const telefonoCliente = typeof body.cliente_telefono === "string"
      ? body.cliente_telefono.trim()
      : "";
    if (!telefonoCliente && !esBorrador && !body.cliente_id) {
      return NextResponse.json(
        errorResponse("Falta el teléfono del cliente: sin eso no se puede hacer el seguimiento."),
        { status: 400 }
      );
    }

    const firma = await firmaUsuario(ctx.supabase, ctx.auth);
    const esAdmin = isAdmin(ctx.auth);
    const vendedorId = typeof body.vendedor_usuario_id === "string" && body.vendedor_usuario_id.trim()
      ? body.vendedor_usuario_id.trim()
      : null;
    const vendedorNombre = typeof body.vendedor_nombre === "string" && body.vendedor_nombre.trim()
      ? body.vendedor_nombre.trim()
      : null;

    const { id, numero_control } = await crearPresupuesto(ctx.supabase, ctx.auth.empresa_id, {
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      cliente_ruc: body.cliente_ruc ? String(body.cliente_ruc) : null,
      cliente_telefono: telefonoCliente,
      cliente_ciudad: body.cliente_ciudad ? String(body.cliente_ciudad).slice(0, 120) : null,
      cliente_profesion: body.cliente_profesion ? String(body.cliente_profesion).slice(0, 120) : null,
      cliente_direccion: body.cliente_direccion ? String(body.cliente_direccion) : null,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      validez_dias: validez,
      forma_pago: body.forma_pago ? String(body.forma_pago) : null,
      plazo_entrega: body.plazo_entrega ? String(body.plazo_entrega) : null,
      observaciones: body.observaciones ? String(body.observaciones).slice(0, 4000) : null,
      // Para adentro. El PDF no las toca a propósito: ver el script 38.
      nota_interna: body.nota_interna ? String(body.nota_interna).slice(0, 4000) : null,
      falta_material: body.falta_material === true,
      /**
       * Las condiciones comerciales las cambia SOLO un administrador.
       *
       * Son las que se discuten si después hay un reclamo: quién paga el
       * flete, qué tolerancia tienen las chapas, en qué plazo se retira. Un
       * vendedor que las ablanda para cerrar una venta compromete a la casa
       * sin que nadie se entere hasta el reclamo.
       *
       * Para los demás se guarda `null` y el documento imprime la plantilla,
       * que es exactamente lo que tiene que salir. Esconder el campo en la
       * pantalla no alcanza: sin este guard, el mismo texto se puede mandar
       * por fuera del formulario.
       */
      condiciones_comerciales:
        isAdmin(ctx.auth) && body.condiciones_comerciales
          ? String(body.condiciones_comerciales).slice(0, 4000)
          : null,
      usuario_id: ctx.auth.user?.id ?? null,
      // El nombre y no el correo: es lo que se muestra en el listado y en la
      // ficha cuando alguien pregunta quién hizo la cotización. Si el usuario
      // no tiene nombre cargado, firmaUsuario cae al correo igual.
      usuario_nombre: firma.nombre,
      // Asignarle el presupuesto a otro es decisión del administrador. Un
      // vendedor que mandara este campo por fuera de la pantalla se estaría
      // poniendo ventas ajenas en su cartera, así que se ignora salvo que
      // tenga el rol.
      vendedor_usuario_id: esAdmin && vendedorId ? vendedorId : null,
      vendedor_nombre: esAdmin && vendedorId ? vendedorNombre : null,
      estado: esBorrador ? "borrador" : "creado",
      // Cómo entró el cliente. Después de guardar no se puede saber: si se
      // escribió a mano con todos sus datos, se le abre la ficha y queda
      // igual que uno elegido del catálogo.
      cliente_a_mano: !body.cliente_id,
      items,
    });

    // El aviso va en la respuesta y no en un error: el presupuesto SE GUARDÓ,
    // y la pantalla tiene que poder decir las dos cosas a la vez —quedó
    // registrado, y así no avanza— sin que parezca que falló.
    return NextResponse.json(successResponse({
      id,
      numero_control,
      estado: esBorrador ? "borrador" : "creado",
      falta: faltan,
      aviso: esBorrador && !autoguardado
        ? `Quedó guardado como BORRADOR porque falta${faltan.length === 1 ? "" : "n"} ` +
          `${textoFaltantes(faltan)}. Se puede imprimir, pero no se puede mandar, aprobar ` +
          "ni cobrar hasta completarlo."
        : null,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo crear el presupuesto.";
    const status = /obligatorio|al menos un|inválid/i.test(msg) ? 400 : 500;
    console.error("[/api/presupuestos POST]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
