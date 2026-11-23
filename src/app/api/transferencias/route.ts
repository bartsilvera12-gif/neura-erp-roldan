import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { resolverCtx, respError, respProhibido, puedeCrearTransferencia } from "./_ctx";
import { MAX_ITEMS_TRANSFERENCIA, mensajeTope, veTotalTransferencia } from "@/lib/transferencias/reglas";
import { crearTransferencia } from "@/lib/transferencias/server/transferencias-pg";
import { listarTransferencias, contarPorEstado } from "@/lib/transferencias/server/transferencias-queries";

/**
 * GET /api/transferencias?filtro=realizadas|recibidas|todas — listado + conteos.
 *
 * Filtros del punto 8.1: `q` busca en el número de transferencia, en el de
 * remisión y en la observación; `estado`, `desde` y `hasta` acotan la lista.
 */
export async function GET(request: NextRequest) {
  const r = await resolverCtx(request);
  if (!r.ok) return r.response;
  try {
    const url = new URL(request.url);
    const sp = url.searchParams;
    const filtroRaw = sp.get("filtro");
    const filtro = filtroRaw === "realizadas" || filtroRaw === "recibidas" ? filtroRaw : "todas";

    const [transferencias, conteos, puedeCrear] = await Promise.all([
      listarTransferencias({
        schemaRaw: r.ctx.schema,
        empresaId: r.ctx.empresaId,
        sucursalId: r.ctx.sucursalId,
        filtro,
        q: sp.get("q"),
        estado: sp.get("estado"),
        desde: sp.get("desde"),
        hasta: sp.get("hasta"),
        usuario: sp.get("usuario"),
      }),
      contarPorEstado({ schemaRaw: r.ctx.schema, empresaId: r.ctx.empresaId, sucursalId: r.ctx.sucursalId }),
      puedeCrearTransferencia(request, r.ctx),
    ]);
    // El total en guaraníes es de administración: al resto ni le llega.
    const veTotal = veTotalTransferencia(r.ctx.rol);
    return NextResponse.json(successResponse({
      transferencias: veTotal ? transferencias : transferencias.map((t) => ({ ...t, total_gs: null })),
      conteos,
      ve_total: veTotal,
      puede_crear: puedeCrear,
    }));
  } catch (err) {
    return respError(err);
  }
}

/** POST /api/transferencias — crear solicitud (la sucursal del usuario es el destino). */
export async function POST(request: NextRequest) {
  const r = await resolverCtx(request);
  if (!r.ok) return r.response;
  // Crea quien tiene el módulo de transferencias (o un rol que ya podía).
  if (!(await puedeCrearTransferencia(request, r.ctx))) {
    return respProhibido("Tu usuario puede ver las transferencias, pero no crearlas: pedile a un administrador el módulo de transferencias.");
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sucursal_origen_id?: unknown;
      sucursal_destino_id?: unknown;
      modo?: unknown;
      items?: unknown;
      observacion?: unknown;
    };
    /**
     * Dos modos:
     *   pedir  (por defecto) — la sucursal del usuario es el DESTINO y elige
     *          de quién pide.
     *   enviar — la sucursal del usuario es el ORIGEN, elige a quién manda y
     *          los productos de su propio catálogo. Nace aprobada.
     */
    const envio = body.modo === "enviar";
    const sucursalOrigenId = envio
      ? r.ctx.sucursalId
      : typeof body.sucursal_origen_id === "string" ? body.sucursal_origen_id : "";
    const sucursalDestinoId = envio
      ? (typeof body.sucursal_destino_id === "string" ? body.sucursal_destino_id : "")
      : r.ctx.sucursalId;
    if (!sucursalOrigenId || !sucursalDestinoId) {
      return NextResponse.json(
        errorResponse(envio ? "Elegí a qué sucursal mandás." : "Elegí la sucursal de origen."),
        { status: 400 }
      );
    }
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items = itemsRaw
      .map((it) => {
        const o = it as {
          producto_destino_id?: unknown; producto_origen_id?: unknown; cantidad_solicitada?: unknown;
        };
        return {
          producto_destino_id: typeof o.producto_destino_id === "string" ? o.producto_destino_id : "",
          // Se puede pedir eligiendo del catálogo de la sucursal que despacha:
          // es lo único que sirve cuando la que pide todavía no tiene el
          // artículo cargado, que es el caso de una sucursal nueva.
          producto_origen_id: typeof o.producto_origen_id === "string" ? o.producto_origen_id : "",
          cantidad_solicitada: Number(o.cantidad_solicitada) || 0,
        };
      })
      .filter((it) => (it.producto_destino_id || it.producto_origen_id) && it.cantidad_solicitada > 0);
    if (items.length === 0) {
      return NextResponse.json(errorResponse("Agregá al menos un producto con cantidad."), { status: 400 });
    }
    if (items.length > MAX_ITEMS_TRANSFERENCIA) {
      return NextResponse.json(errorResponse(mensajeTope("transferencia", MAX_ITEMS_TRANSFERENCIA)), { status: 400 });
    }
    const observacion =
      typeof body.observacion === "string" ? body.observacion.trim().slice(0, 500) || null : null;

    // En un envío se eligen productos del catálogo PROPIO (el origen).
    const out = await crearTransferencia({
      schemaRaw: r.ctx.schema,
      empresaId: r.ctx.empresaId,
      sucursalDestinoId,
      sucursalOrigenId,
      items: envio
        ? items.map((it) => ({ producto_origen_id: it.producto_origen_id || it.producto_destino_id, cantidad_solicitada: it.cantidad_solicitada }))
        : items,
      observacion,
      usuarioId: r.ctx.usuarioId,
      envio,
      sinAprobacion: true,
    });
    return NextResponse.json(successResponse({ id: out.id, numero: out.numero }));
  } catch (err) {
    return respError(err);
  }
}
