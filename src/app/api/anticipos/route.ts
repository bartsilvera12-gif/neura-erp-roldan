import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaUsuario } from "@/lib/usuarios/server/firma-usuario";
import { getCajaAbierta } from "@/lib/caja/server";

/**
 * Anticipos de clientes (punto 5.6).
 *
 * GET  → listado con filtros y el acumulado por cliente.
 * POST → registra un anticipo nuevo.
 *
 * QUÉ ES UN ANTICIPO Y POR QUÉ NO ES UNA VENTA
 *   Plata que el cliente dejó a cuenta y todavía no se facturó. Hasta que se
 *   use, es una DEUDA de la empresa con el cliente, no un ingreso ganado. Por
 *   eso vive en su propia tabla con su propio estado, y no como un movimiento
 *   de caja más: hay que poder contestar "¿cuánto debemos en mercadería?" sin
 *   recorrer turnos uno por uno.
 *
 *   Sí entra al arqueo del turno, porque la plata está físicamente en el
 *   cajón.
 */

const FALTA_TABLA = "Falta correr 25_caja_modulo5.sql en la base.";
const esTablaFaltante = (m: string) =>
  /anticipos/.test(m) && /(does not exist|schema cache|PGRST205)/i.test(m);

const OFFSET_PY = "-03:00";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const estado = (sp.get("estado") ?? "").trim();
    const clienteId = (sp.get("cliente") ?? "").trim();
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? sp.get("desde")! : null;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? sp.get("hasta")! : null;
    const q = (sp.get("q") ?? "").trim();

    let qb = aplicarFiltroSucursal(
      ctx.supabase
        .from("anticipos")
        .select("id, numero, cliente_id, cliente_nombre, fecha, monto, medio_pago, estado, venta_id, usuario_nombre, observacion, anulado_at, anulado_por, anulado_motivo")
        .eq("empresa_id", empresaId),
      sucursalId
    );
    if (estado) qb = qb.eq("estado", estado);
    if (clienteId) qb = qb.eq("cliente_id", clienteId);
    // El día "hasta" entra entero.
    if (desde) qb = qb.gte("fecha", `${desde}T00:00:00${OFFSET_PY}`);
    if (hasta) qb = qb.lte("fecha", `${hasta}T23:59:59.999${OFFSET_PY}`);
    if (q) {
      const t = q.replace(/[(),]/g, " ").trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      if (t) qb = qb.or(`numero.ilike.%${t}%,cliente_nombre.ilike.%${t}%,observacion.ilike.%${t}%`);
    }

    const r = await qb.order("fecha", { ascending: false }).limit(500);
    if (r.error) {
      if (esTablaFaltante(r.error.message ?? "")) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
      }
      throw new Error(r.error.message);
    }

    const filas = ((r.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      numero: a.numero == null ? null : String(a.numero),
      cliente_id: a.cliente_id == null ? null : String(a.cliente_id),
      cliente_nombre: a.cliente_nombre == null ? "" : String(a.cliente_nombre),
      fecha: String(a.fecha ?? ""),
      monto: Number(a.monto) || 0,
      medio_pago: String(a.medio_pago ?? "efectivo"),
      estado: String(a.estado ?? "activo"),
      venta_id: a.venta_id == null ? null : String(a.venta_id),
      usuario_nombre: a.usuario_nombre == null ? "" : String(a.usuario_nombre),
      observacion: a.observacion == null ? "" : String(a.observacion),
      anulado_motivo: a.anulado_motivo == null ? null : String(a.anulado_motivo),
      anulado_por: a.anulado_por == null ? null : String(a.anulado_por),
    }));

    // El acumulado por cliente es la pregunta del mostrador: "¿cuánto tiene
    // a favor este cliente?". Solo cuentan los activos — un anticipo usado ya
    // se aplicó a una venta y uno anulado se devolvió.
    const acumulado = new Map<string, { nombre: string; total: number; cantidad: number }>();
    for (const a of filas) {
      if (a.estado !== "activo") continue;
      const k = a.cliente_id ?? `__${a.cliente_nombre}`;
      const act = acumulado.get(k) ?? { nombre: a.cliente_nombre || "Sin cliente", total: 0, cantidad: 0 };
      act.total += a.monto;
      act.cantidad += 1;
      acumulado.set(k, act);
    }

    const activos = filas.filter((a) => a.estado === "activo");
    return NextResponse.json(successResponse({
      anticipos: filas,
      por_cliente: [...acumulado.entries()]
        .map(([cliente_id, v]) => ({ cliente_id, ...v }))
        .sort((a, b) => b.total - a.total),
      resumen: {
        total: filas.length,
        activos: activos.length,
        monto_activo: activos.reduce((s, a) => s + a.monto, 0),
        utilizados: filas.filter((a) => a.estado === "utilizado").length,
        anulados: filas.filter((a) => a.estado === "anulado").length,
      },
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/anticipos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los anticipos."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const monto = Number(b.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(errorResponse("El monto tiene que ser mayor a cero."), { status: 400 });
    }

    const clienteId = typeof b.cliente_id === "string" && b.cliente_id.trim() ? b.cliente_id.trim() : null;
    let clienteNombre = typeof b.cliente_nombre === "string" ? b.cliente_nombre.trim() : "";
    if (clienteId) {
      const c = await ctx.supabase
        .from("clientes")
        .select("id, nombre, empresa, nombre_contacto, nombre_facturacion")
        .eq("empresa_id", empresaId).eq("id", clienteId).maybeSingle();
      if (c.error) throw new Error(c.error.message);
      if (!c.data) return NextResponse.json(errorResponse("Cliente no encontrado."), { status: 404 });
      const row = c.data as Record<string, unknown>;
      clienteNombre =
        String(row.nombre_facturacion ?? "") ||
        String(row.empresa ?? "") ||
        String(row.nombre_contacto ?? "") ||
        String(row.nombre ?? "");
    }
    if (!clienteNombre) {
      return NextResponse.json(
        errorResponse("Poné de quién es el anticipo: sin cliente no se le puede devolver ni aplicar."),
        { status: 400 }
      );
    }

    const medio = ["efectivo", "transferencia", "tarjeta", "cheque"].includes(String(b.medio_pago))
      ? String(b.medio_pago)
      : "efectivo";

    // Se ata al turno abierto para que entre en su arqueo. Sin turno abierto
    // igual se registra: el anticipo existe aunque la caja esté cerrada.
    const caja = await getCajaAbierta(ctx.supabase, empresaId, sucursalId).catch(() => null);
    const firma = await firmaUsuario(ctx.supabase, ctx.auth);

    const ins = await ctx.supabase
      .from("anticipos")
      .insert({
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        cliente_id: clienteId,
        cliente_nombre: clienteNombre,
        monto,
        medio_pago: medio,
        estado: "activo",
        caja_id: caja?.id ?? null,
        usuario_id: firma.id,
        usuario_nombre: firma.nombre,
        observacion: typeof b.observacion === "string" && b.observacion.trim()
          ? b.observacion.trim() : null,
      })
      .select("id, numero, monto, cliente_nombre")
      .single();

    if (ins.error) {
      if (esTablaFaltante(ins.error.message)) {
        return NextResponse.json(errorResponse(FALTA_TABLA), { status: 500 });
      }
      throw new Error(ins.error.message);
    }

    return NextResponse.json(successResponse({
      anticipo: ins.data,
      en_caja: Boolean(caja),
    }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/anticipos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el anticipo."), { status: 500 });
  }
}
