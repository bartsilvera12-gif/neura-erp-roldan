import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { validarRucOCedula } from "@/lib/clientes/identificador";
import { faltantesDelPresupuesto } from "@/lib/presupuestos/faltantes";
import { asegurarClienteDelPresupuesto } from "@/lib/presupuestos/server/cliente-del-presupuesto";
import { faltantesDeStock, mensajeFaltantes } from "@/lib/presupuestos/server/stock-presupuesto";
import { isAdmin } from "@/lib/middleware/auth";
import { tieneFacultad } from "@/lib/perfiles/server/facultades-usuario";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "@/lib/presupuestos/types";
import {
  conCamposScript38,
  faltaScript38,
  faltaScript46,
  leerPresupuestosConFallback,
} from "@/lib/presupuestos/server/presupuestos-select";

const ITEM_COLS =
  "id, producto_id, producto_nombre, sku, cantidad, unidad_medida, precio_unitario, iva_tipo, subtotal, monto_iva, descuento, total";

/** GET /api/presupuestos/[id] — detalle + ítems. */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const pq = await leerPresupuestosConFallback<Record<string, unknown>>((cols) =>
      ctx.supabase
        .from("presupuestos")
        .select(cols)
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .maybeSingle() as unknown as PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>
    );
    if (pq.error) throw new Error(pq.error.message);
    if (!pq.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const cabecera = conCamposScript38(pq.data, pq.script38);

    const itq = await ctx.supabase
      .from("presupuesto_items")
      .select(ITEM_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id)
      .order("created_at", { ascending: true });
    if (itq.error) throw new Error(itq.error.message);

    // Las condiciones comerciales (punto 9.4) van en su propia consulta: si se
    // sumaran a PRESU_COLS, en una base sin el script 27 fallaría la lectura
    // del presupuesto entero y la pantalla quedaría en blanco.
    let condiciones: string | null = null;
    const cq = await ctx.supabase
      .from("presupuestos")
      .select("condiciones_comerciales")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (!cq.error && cq.data) {
      const v = (cq.data as Record<string, unknown>).condiciones_comerciales;
      condiciones = v == null ? null : String(v);
    }

    return NextResponse.json(successResponse({
      presupuesto: { ...cabecera, condiciones_comerciales: condiciones },
      items: itq.data ?? [],
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[/api/presupuestos/[id] GET]", msg);
    return NextResponse.json(errorResponse(`No se pudo cargar el presupuesto. ${msg}`), { status: 500 });
  }
}

/**
 * DELETE /api/presupuestos/[id] — elimina el presupuesto y sus ítems.
 * Prohibido si estado === 'convertido' (ya generó un pedido).
 */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const cur = await ctx.supabase
      .from("presupuestos")
      .select("estado")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if ((cur.data as { estado: string }).estado === "convertido") {
      return NextResponse.json(errorResponse("El presupuesto ya fue convertido; no se puede eliminar."), { status: 409 });
    }

    const delItems = await ctx.supabase
      .from("presupuesto_items")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id);
    if (delItems.error) throw new Error(delItems.error.message);

    const delHead = await ctx.supabase
      .from("presupuestos")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (delHead.error) throw new Error(delHead.error.message);

    return NextResponse.json(successResponse({ deleted: true }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el presupuesto."), { status: 500 });
  }
}

/**
 * PATCH /api/presupuestos/[id] — dos modos:
 *   1) Solo `estado` en el body → cambio de estado (creado|enviado|aprobado|rechazado).
 *   2) Body con `items` (y opcionalmente cliente_*, moneda, condiciones) → edicion
 *      completa: reemplaza header + items. Prohibido si estado === 'convertido'.
 * NO permite setear 'convertido' por acá (eso lo hace /convertir). NO toca stock.
 */
function asIva(v: unknown): "EXENTA" | "5%" | "10%" {
  return v === "EXENTA" || v === "5%" || v === "10%" ? v : "10%";
}
/**
 * Misma cuenta que al crear (presupuestos-pg.ts): contando el día de emisión,
 * en fecha de Paraguay (UTC−3).
 */
function vencimientoDesde(fechaEmision: string | null | undefined, validez: number | null): string | null {
  if (!validez || validez <= 0) return null;
  const t = fechaEmision ? new Date(fechaEmision).getTime() : NaN;
  const d = new Date((Number.isFinite(t) ? t : Date.now()) - 3 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + (validez - 1));
  return d.toISOString().slice(0, 10);
}

export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    // Con el rol: las condiciones comerciales las cambia solo un administrador.
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    // Verificar estado actual (no editable si convertido).
    const cur = await ctx.supabase
      .from("presupuestos")
      .select("estado, cliente_ruc, cliente_id, fecha")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if ((cur.data as { estado: string }).estado === "convertido") {
      return NextResponse.json(errorResponse("El presupuesto ya fue convertido; no se puede editar."), { status: 409 });
    }

    const eraBorrador = (cur.data as { estado: string }).estado === "borrador";
    /**
     * Guardado automático de un borrador que se está armando: se guarda tal
     * cual y sigue siendo borrador (no pasa a firme ni le abre la ficha al
     * cliente aunque ya tenga todo). Eso lo hace el botón Guardar.
     */
    const autoguardado = body.autoguardado === true;
    if (autoguardado && !eraBorrador) {
      return NextResponse.json(errorResponse("Ya no es un borrador."), { status: 409 });
    }

    /**
     * En un BORRADOR el RUC puede estar vacío o mal: es justamente lo que le
     * falta, y por eso es un borrador. Validarlo acá impediría guardar la
     * corrección a medias —el que consiguió el teléfono pero todavía no el
     * RUC—, que es el caso para el que existe el borrador.
     *
     * Para el resto sigue valiendo: el RUC se exige al CREAR, al editar no se
     * pide uno que nunca hubo —hay presupuestos anteriores a esta regla y
     * bloquearlos impediría corregirles un teléfono— pero tampoco se deja
     * BORRAR el que ya está, que sería saltear la regla desde la edición.
     */
    if (!eraBorrador && body.cliente_ruc !== undefined) {
      const rucActual = String((cur.data as { cliente_ruc?: string | null }).cliente_ruc ?? "").trim();
      const rucNuevo = String(body.cliente_ruc ?? "").trim();
      if (rucActual !== "" || rucNuevo !== "") {
        const ident = validarRucOCedula(rucNuevo);
        if (!ident.ok) {
          return NextResponse.json(
            errorResponse(ident.error ?? "Cargá el RUC o la cédula del cliente."),
            { status: 400 }
          );
        }
      }
    }

    // ═══════ MODO 2: edicion completa (body incluye items) ═══════
    if (Array.isArray(body.items)) {
      const rawItems = body.items as Record<string, unknown>[];
      if (rawItems.length === 0) {
        return NextResponse.json(errorResponse("El presupuesto debe tener al menos un item."), { status: 400 });
      }
      const clienteNombre = String(body.cliente_nombre ?? "").trim();
      if (!clienteNombre) {
        return NextResponse.json(errorResponse("El nombre del cliente es obligatorio."), { status: 400 });
      }

      // Calcular totales desde los items.
      let subtotal = 0, monto_iva = 0, descuento_total = 0, total = 0;
      const itemsToInsert: Record<string, unknown>[] = [];
      for (const it of rawItems) {
        const cantidad = Number(it.cantidad);
        const precio = Number(it.precio_unitario);
        const desc = Math.max(0, Number(it.descuento) || 0);
        const iva_tipo = asIva(it.iva_tipo);
        const nombre = String(it.producto_nombre ?? "").trim();
        if (!nombre || !(cantidad > 0) || !(precio >= 0)) {
          return NextResponse.json(errorResponse(`Item invalido: ${nombre || "sin nombre"}`), { status: 400 });
        }
        const bruto = cantidad * precio - desc;
        const factor = iva_tipo === "10%" ? 1.1 : iva_tipo === "5%" ? 1.05 : 1;
        const sub = iva_tipo === "EXENTA" ? bruto : bruto / factor;
        const iva = bruto - sub;
        subtotal += sub;
        monto_iva += iva;
        descuento_total += desc;
        total += bruto;
        itemsToInsert.push({
          empresa_id: ctx.auth.empresa_id,
          presupuesto_id: id,
          producto_id: it.producto_id ? String(it.producto_id) : null,
          producto_nombre: nombre,
          sku: it.sku ? String(it.sku) : null,
          cantidad,
          unidad_medida: it.unidad_medida ? String(it.unidad_medida) : null,
          precio_unitario: precio,
          iva_tipo,
          subtotal: Math.round(sub),
          monto_iva: Math.round(iva),
          descuento: desc,
          total: Math.round(bruto),
        });
      }

      // Mismo criterio que al crear: cotizar más de lo que hay lo hace un
      // administrador. Sin esto, se guarda un presupuesto con stock y después
      // se le suben las cantidades desde la edición. El autoguardado no
      // frena: es lo que se está escribiendo; el control va al apretar Guardar.
      if (!autoguardado && !(await tieneFacultad(ctx.supabase, ctx.auth, "cotizar_sin_stock"))) {
        const faltantes = await faltantesDeStock(
          ctx.supabase,
          ctx.auth.empresa_id,
          ctx.auth.sucursal_id ?? null,
          itemsToInsert.map((it) => ({
            producto_id: it.producto_id ? String(it.producto_id) : null,
            producto_nombre: String(it.producto_nombre ?? ""),
            cantidad: Number(it.cantidad) || 0,
          }))
        );
        if (faltantes.length > 0) {
          return NextResponse.json(errorResponse(mensajeFaltantes(faltantes)), { status: 403 });
        }
      }

      // Delete items viejos + insertar nuevos.
      const delR = await ctx.supabase.from("presupuesto_items").delete()
        .eq("empresa_id", ctx.auth.empresa_id).eq("presupuesto_id", id);
      if (delR.error) throw new Error(delR.error.message);
      const insR = await ctx.supabase.from("presupuesto_items").insert(itemsToInsert);
      if (insR.error) throw new Error(insR.error.message);

      const validezRaw = body.validez_dias;
      const validez = validezRaw === null || validezRaw === undefined || String(validezRaw).trim() === ""
        ? null
        : Math.max(0, parseInt(String(validezRaw), 10) || 0) || null;

      /**
       * SALIR DE BORRADOR
       *
       * Un borrador sale de borrador cuando se completan los datos del
       * cliente, y recién ahí se le abre la ficha. Es el único camino: los
       * botones de estado no lo mueven, y el servidor no lo deja avanzar
       * mientras falte algo. Si todavía falta, se guarda la corrección y
       * sigue siendo borrador —lo que se consiguió no se pierde—.
       *
       * Al presupuesto que ya era firme no se lo toca: se guarda su edición y
       * conserva su estado.
       */
      let clienteIdFinal = body.cliente_id ? String(body.cliente_id) : null;
      let estadoNuevo: string | null = null;
      if (eraBorrador && !autoguardado) {
        const faltan = faltantesDelPresupuesto({
          cliente_id: clienteIdFinal,
          nombre: clienteNombre,
          ruc: body.cliente_ruc as string | null | undefined,
          telefono: body.cliente_telefono as string | null | undefined,
          profesion: body.cliente_profesion as string | null | undefined,
          ciudad: body.cliente_ciudad as string | null | undefined,
        });
        if (faltan.length === 0) {
          clienteIdFinal = await asegurarClienteDelPresupuesto(
            ctx.supabase,
            {
              empresaId: ctx.auth.empresa_id,
              userId: ctx.auth.user.id,
              emailCreador:
                (typeof ctx.auth.user?.email === "string" ? ctx.auth.user.email.trim() : "") || null,
            },
            {
              cliente_id: clienteIdFinal,
              nombre: clienteNombre,
              ruc: body.cliente_ruc as string | null | undefined,
              telefono: body.cliente_telefono as string | null | undefined,
              direccion: body.cliente_direccion as string | null | undefined,
              ciudad: body.cliente_ciudad as string | null | undefined,
              profesion: body.cliente_profesion as string | null | undefined,
              moneda: body.moneda === "USD" ? "USD" : "GS",
            }
          );
          estadoNuevo = "creado";
        }
      }

      const parcheCabecera: Record<string, unknown> = {
        cliente_id: clienteIdFinal,
        // Un borrador puede haber nacido con el cliente escrito y después
        // elegirse del catálogo: cómo entró se decide con lo último.
        ...(eraBorrador ? { cliente_a_mano: !body.cliente_id } : {}),
        // A nombre de quién va: lo decide el administrador, igual que al crear.
        // Hace falta acá porque el presupuesto nuevo se guarda primero como
        // borrador y después se completa sobre ese mismo.
        ...(isAdmin(ctx.auth) && typeof body.vendedor_usuario_id === "string" && body.vendedor_usuario_id.trim()
          ? {
              vendedor_usuario_id: body.vendedor_usuario_id.trim(),
              vendedor_nombre: typeof body.vendedor_nombre === "string" ? body.vendedor_nombre.trim() || null : null,
            }
          : {}),
        ...(estadoNuevo ? { estado: estadoNuevo } : {}),
        cliente_nombre: clienteNombre,
        cliente_ruc: body.cliente_ruc ? String(body.cliente_ruc) : null,
        cliente_telefono: body.cliente_telefono ? String(body.cliente_telefono) : null,
        cliente_direccion: body.cliente_direccion ? String(body.cliente_direccion) : null,
        // Ciudad y profesión: son dos de los datos que dejan al presupuesto en
        // borrador, así que si la edición no los guardara, completarlos no
        // serviría de nada.
        cliente_ciudad: body.cliente_ciudad ? String(body.cliente_ciudad) : null,
        cliente_profesion: body.cliente_profesion ? String(body.cliente_profesion) : null,
        moneda: body.moneda === "USD" ? "USD" : "PYG",
        subtotal: Math.round(subtotal),
        monto_iva: Math.round(monto_iva),
        descuento_total: Math.round(descuento_total),
        total: Math.round(total),
        validez_dias: validez,
        // El vencimiento acompaña a la validez. Antes se guardaba la validez
        // nueva y el vencimiento quedaba el de la creación: el PDF decía
        // "30 días" y el listado lo daba por vencido a los 15.
        fecha_vencimiento: vencimientoDesde((cur.data as { fecha?: string | null }).fecha, validez),
        forma_pago: body.forma_pago ? String(body.forma_pago) : null,
        plazo_entrega: body.plazo_entrega ? String(body.plazo_entrega) : null,
        observaciones: body.observaciones ? String(body.observaciones).slice(0, 4000) : null,
        // Para adentro. El PDF no las toca a propósito: ver el script 38.
        nota_interna: body.nota_interna ? String(body.nota_interna).slice(0, 4000) : null,
        falta_material: body.falta_material === true,
        // Las condiciones comerciales las cambia solo un administrador.
        //
        // Para el resto NO se escribe la columna, en vez de escribirle null:
        // si un vendedor edita un presupuesto que el administrador había
        // personalizado, poner null le borraría ese texto sin que nadie lo
        // pida. Omitir la clave deja lo que ya estaba.
        ...(isAdmin(ctx.auth)
          ? {
              condiciones_comerciales: body.condiciones_comerciales
                ? String(body.condiciones_comerciales).slice(0, 4000)
                : null,
            }
          : {}),
        updated_at: new Date().toISOString(),
      };

      const guardarCabecera = (patch: Record<string, unknown>) =>
        leerPresupuestosConFallback<Record<string, unknown>>((cols) =>
          ctx.supabase.from("presupuestos").update(patch)
            .eq("empresa_id", ctx.auth.empresa_id)
            .eq("id", id)
            .select(cols)
            .maybeSingle() as unknown as PromiseLike<{
              data: Record<string, unknown> | null;
              error: { message: string } | null;
            }>
        );

      let updHead = await guardarCabecera(parcheCabecera);
      // Sin el script 27 se guarda el resto de la edición igual que antes, en
      // vez de rechazarla entera por una columna que todavía no existe.
      if (updHead.error && /condiciones_comerciales/.test(updHead.error.message ?? "")) {
        const { condiciones_comerciales: _omitido, ...sinCondiciones } = parcheCabecera;
        updHead = await guardarCabecera(sinCondiciones);
      }
      // Mismo criterio para el script 38: la nota interna se pierde, pero la
      // edición se guarda.
      if (updHead.error && faltaScript38(updHead.error.message)) {
        const { nota_interna: _n, falta_material: _f, ...sinScript38 } = parcheCabecera;
        updHead = await guardarCabecera(sinScript38);
      }
      // Y para el 46: sin esas columnas no hay dónde guardar ciudad y
      // profesión, pero el resto de la edición no tiene por qué caerse.
      if (updHead.error && /cliente_a_mano/.test(updHead.error.message ?? "")) {
        const { cliente_a_mano: _am, ...sinAMano } = parcheCabecera;
        updHead = await guardarCabecera(sinAMano);
      }
      if (updHead.error && faltaScript46(updHead.error.message)) {
        const { cliente_ciudad: _c, cliente_profesion: _p, ...sin46 } = parcheCabecera;
        updHead = await guardarCabecera(sin46);
      }
      if (updHead.error) throw new Error(updHead.error.message);
      return NextResponse.json(
        successResponse({
          presupuesto: updHead.data ? conCamposScript38(updHead.data, updHead.script38) : null,
        })
      );
    }

    // ═══════ MODO 1: cambio de estado ═══════
    const nuevoEstado = body.estado as EstadoPresupuesto | undefined;
    if (!nuevoEstado || !ESTADOS_PRESUPUESTO.includes(nuevoEstado)) {
      return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
    }
    if (nuevoEstado === "convertido") {
      return NextResponse.json(
        errorResponse("Para convertir usá la acción 'Convertir en pedido'."),
        { status: 400 }
      );
    }
    /**
     * Un borrador no avanza por un botón de estado.
     *
     * Le faltan los datos del cliente: mandarlo, aprobarlo o cobrarlo con la
     * ficha incompleta es exactamente lo que el borrador existe para evitar.
     * El camino es completarlo en Editar; ahí el servidor lo pasa a "creado"
     * y le abre la ficha al cliente.
     */
    if (eraBorrador && nuevoEstado !== "borrador") {
      return NextResponse.json(
        errorResponse(
          "Es un borrador: completá los datos del cliente en Editar y pasa a presupuesto firme solo."
        ),
        { status: 409 }
      );
    }

    const upd = await leerPresupuestosConFallback<Record<string, unknown>>((cols) =>
      ctx.supabase
        .from("presupuestos")
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .select(cols)
        .maybeSingle() as unknown as PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>
    );
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(
      successResponse({ presupuesto: conCamposScript38(upd.data, upd.script38) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[/api/presupuestos/[id] PATCH]", msg);
    return NextResponse.json(errorResponse(`No se pudo actualizar el presupuesto. ${msg}`), { status: 500 });
  }
}
