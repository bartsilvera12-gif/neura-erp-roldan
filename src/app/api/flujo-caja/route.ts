import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { mensajeErrorFlujo } from "@/lib/flujo-caja/errores";
import type {
  DiagnosticoFlujo, EntradaFlujo, EstadoCheque, FilaFlujo, FlujoCajaMes, MonedaFlujo, TipoSaldo, TotalesDia,
} from "@/lib/flujo-caja/types";

/**
 * GET /api/flujo-caja?anio=2026&mes=11
 *
 * Arma el flujo del mes: una fila por proveedor (los chicos agrupados en
 * VARIOS) y una columna por día. En cada celda caen las facturas de compra a
 * crédito cuya fecha de pago (fecha_factura + plazo_dias) es ese día, con el
 * cheque que las cubre si ya existe.
 *
 * Los cheques cobrados y los anulados no suman: ya salieron del banco.
 *
 * PUT /api/flujo-caja — guarda el tipo de cambio y los fondos del mes.
 */

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Suma días a una fecha YYYY-MM-DD sin pasar por zonas horarias. */
function sumarDias(fechaIso: string, dias: number): string {
  const [y, m, d] = fechaIso.slice(0, 10).split("-").map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

function parsePeriodo(sp: URLSearchParams): { anio: number; mes: number } {
  const hoy = new Date();
  const anio = Number(sp.get("anio")) || hoy.getUTCFullYear();
  const mes = Number(sp.get("mes")) || hoy.getUTCMonth() + 1;
  return {
    anio: Math.min(2100, Math.max(2000, anio)),
    mes: Math.min(12, Math.max(1, mes)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const { anio, mes } = parsePeriodo(new URL(request.url).searchParams);

    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(diasDelMes).padStart(2, "0")}`;

    // ── Config del mes (tipo de cambio y fondos). Si no existe, valores en cero.
    const cfgQ = await ctx.supabase
      .from("flujo_caja_config")
      .select("anio, mes, tipo_cambio, fondos_disponibles, observacion")
      .eq("empresa_id", empresaId).eq("anio", anio).eq("mes", mes)
      .maybeSingle();
    if (cfgQ.error) throw new Error(cfgQ.error.message);

    // Si el mes todavía no tiene config, el tipo de cambio se hereda del último
    // mes que sí la tenga. Sin esto, abrir un mes nuevo dejaba la grilla entera
    // en cero hasta que alguien volviera a escribir el cambio a mano.
    let tipoCambio = num(cfgQ.data?.tipo_cambio);
    if (tipoCambio <= 0) {
      const previaQ = await ctx.supabase
        .from("flujo_caja_config")
        .select("anio, mes, tipo_cambio")
        .eq("empresa_id", empresaId)
        .gt("tipo_cambio", 0)
        .order("anio", { ascending: false })
        .order("mes", { ascending: false })
        .limit(12);
      if (previaQ.error) throw new Error(previaQ.error.message);
      const previa = ((previaQ.data ?? []) as Array<Record<string, unknown>>)
        .find((c) => Number(c.anio) * 12 + Number(c.mes) < anio * 12 + mes);
      if (previa) tipoCambio = num(previa.tipo_cambio);
    }

    // ── Fondos con los que arranca el mes.
    //    Si hay posición de liquidez cargada, manda ella: bancos + efectivo,
    //    convertidos a guaraníes. La mercadería NO entra: no es plata disponible.
    //    Si no hay nada cargado, vale el monto manual de la config.
    const saldosQ = await ctx.supabase
      .from("flujo_caja_saldos")
      .select("tipo, descripcion, moneda, importe")
      .eq("empresa_id", empresaId).eq("anio", anio).eq("mes", mes);
    if (saldosQ.error) throw new Error(saldosQ.error.message);
    const saldos = (saldosQ.data ?? []) as Array<Record<string, unknown>>;

    let liquidezGs = 0, mercaderiaGs = 0;
    for (const s of saldos) {
      const enGs = String(s.moneda ?? "PYG").toUpperCase() === "USD"
        ? num(s.importe) * tipoCambio
        : num(s.importe);
      if (String(s.tipo) === "mercaderia") mercaderiaGs += enGs;
      else liquidezGs += enGs;
    }
    const fondos = saldos.length > 0 ? liquidezGs : num(cfgQ.data?.fondos_disponibles);

    // ── Proveedores: definen las filas y qué se agrupa en VARIOS.
    const provQ = await ctx.supabase
      .from("proveedores")
      .select("id, nombre, moneda_preferida, agrupa_en_varios")
      .eq("empresa_id", empresaId);
    if (provQ.error) throw new Error(provQ.error.message);
    const proveedores = new Map<string, { nombre: string; moneda: MonedaFlujo; varios: boolean }>();
    for (const p of (provQ.data ?? []) as Array<Record<string, unknown>>) {
      proveedores.set(String(p.id), {
        nombre: String(p.nombre ?? ""),
        moneda: String(p.moneda_preferida ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG",
        varios: p.agrupa_en_varios === true,
      });
    }

    // ── Compras a crédito vivas. El filtro por fecha se hace en memoria porque
    //    la fecha de pago es fecha_factura + plazo_dias, que no es una columna.
    const comprasQ = await ctx.supabase
      .from("compras")
      .select("numero_control, numero_factura, proveedor_id, proveedor_nombre, fecha, fecha_factura, plazo_dias, total, moneda, tipo_cambio, estado, tipo_pago")
      .eq("empresa_id", empresaId)
      .not("estado", "in", '("anulada")');
    if (comprasQ.error) throw new Error(comprasQ.error.message);

    /** Una factura = N filas de `compras` con el mismo numero_control. */
    type Factura = {
      numero_control: string; numero_factura: string | null;
      proveedor_id: string; proveedor_nombre: string;
      fecha_pago: string; moneda: MonedaFlujo; importe: number; pagada: boolean;
    };
    const facturas = new Map<string, Factura>();
    /** Toda factura no anulada, a crédito o no. Solo sirve para el diagnóstico. */
    const todasLasFacturas = new Set<string>();
    for (const r of (comprasQ.data ?? []) as Array<Record<string, unknown>>) {
      const nc = String(r.numero_control ?? "");
      if (!nc) continue;
      todasLasFacturas.add(nc);
      if (String(r.tipo_pago ?? "") !== "credito") continue;
      const base = String(r.fecha_factura ?? r.fecha ?? "").slice(0, 10);
      if (!base) continue;
      const totalGs = num(r.total);
      const esUsd = String(r.moneda ?? "PYG").toUpperCase() === "USD";
      const tcCompra = num(r.tipo_cambio) || 1;

      const prev = facturas.get(nc);
      if (prev) {
        prev.importe += esUsd ? totalGs / tcCompra : totalGs;
        continue;
      }
      facturas.set(nc, {
        numero_control: nc,
        numero_factura: r.numero_factura == null ? null : String(r.numero_factura),
        proveedor_id: String(r.proveedor_id ?? ""),
        proveedor_nombre: String(r.proveedor_nombre ?? ""),
        fecha_pago: sumarDias(base, Number(r.plazo_dias) || 0),
        moneda: esUsd ? "USD" : "PYG",
        importe: esUsd ? totalGs / tcCompra : totalGs,
        pagada: String(r.estado ?? "") === "pagada",
      });
    }

    // ── Cheques del mes y sus facturas.
    const chequesQ = await ctx.supabase
      .from("cheques")
      .select("id, proveedor_id, proveedor_nombre, numero, banco_nombre, moneda, importe, estado, fecha_pago_prevista, fecha_emision, fecha_cobro_real, fecha_cobro_prevista, observacion")
      .eq("empresa_id", empresaId)
      .gte("fecha_pago_prevista", desde)
      .lte("fecha_pago_prevista", hasta);
    if (chequesQ.error) throw new Error(chequesQ.error.message);
    const cheques = (chequesQ.data ?? []) as Array<Record<string, unknown>>;

    const chequeIds = cheques.map((c) => String(c.id));
    const porCheque = new Map<string, { numero_control: string; importe_imputado: number }[]>();
    const facturaConCheque = new Set<string>();
    if (chequeIds.length > 0) {
      const ccQ = await ctx.supabase
        .from("cheque_compras")
        .select("cheque_id, compra_numero_control, importe_imputado")
        .eq("empresa_id", empresaId)
        .in("cheque_id", chequeIds);
      if (ccQ.error) throw new Error(ccQ.error.message);
      for (const r of (ccQ.data ?? []) as Array<Record<string, unknown>>) {
        const cid = String(r.cheque_id);
        const nc = String(r.compra_numero_control ?? "");
        if (!porCheque.has(cid)) porCheque.set(cid, []);
        porCheque.get(cid)!.push({ numero_control: nc, importe_imputado: num(r.importe_imputado) });
        facturaConCheque.add(nc);
      }
    }

    // ── Armado de las filas.
    const filas = new Map<string, FilaFlujo>();
    const CLAVE_VARIOS = "__varios__";

    const filaDe = (proveedorId: string, nombre: string, moneda: MonedaFlujo): FilaFlujo => {
      const info = proveedores.get(proveedorId);
      const varios = info?.varios === true;
      const clave = varios ? CLAVE_VARIOS : proveedorId;
      let f = filas.get(clave);
      if (!f) {
        f = {
          proveedor_id: varios ? null : proveedorId,
          nombre: varios ? "VARIOS" : (info?.nombre || nombre || "—"),
          es_varios: varios,
          // VARIOS son los proveedores chicos/locales: van en guaraníes.
          moneda: varios ? "PYG" : (info?.moneda ?? moneda),
          dias: {},
          total_usd: 0,
          total_gs: 0,
        };
        filas.set(clave, f);
      }
      return f;
    };

    const push = (fila: FilaFlujo, dia: number, e: EntradaFlujo) => {
      if (!fila.dias[dia]) fila.dias[dia] = [];
      fila.dias[dia].push(e);
      if (e.estado === "cobrado" || e.estado === "anulado") return;
      // Cada moneda a su total: la fila lleva la moneda habitual del proveedor,
      // pero una factura suelta puede venir en la otra.
      if (e.moneda === "USD") fila.total_usd += e.importe;
      else fila.total_gs += e.importe;
    };

    // Cheques primero: mandan sobre las facturas que cubren.
    for (const c of cheques) {
      const fp = String(c.fecha_pago_prevista ?? "").slice(0, 10);
      const dia = Number(fp.slice(8, 10));
      if (!dia) continue;
      const provId = String(c.proveedor_id ?? "");
      const moneda: MonedaFlujo = String(c.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG";
      const importe = num(c.importe);
      const cubre = porCheque.get(String(c.id)) ?? [];
      const fila = filaDe(provId, String(c.proveedor_nombre ?? ""), moneda);

      push(fila, dia, {
        tipo: "cheque",
        cheque_id: String(c.id),
        estado: String(c.estado ?? "pendiente_emision") as EstadoCheque,
        moneda,
        importe,
        importe_gs: moneda === "USD" ? importe * tipoCambio : importe,
        numero_factura: cubre.length === 1
          ? facturas.get(cubre[0].numero_control)?.numero_factura ?? null
          : null,
        numero_control: cubre.length === 1 ? cubre[0].numero_control : null,
        facturas: cubre.map((x) => ({
          numero_control: x.numero_control,
          numero_factura: facturas.get(x.numero_control)?.numero_factura ?? null,
          importe_imputado: x.importe_imputado,
        })),
        numero_cheque: c.numero == null ? null : String(c.numero),
        banco_nombre: c.banco_nombre == null ? null : String(c.banco_nombre),
        fecha_emision: c.fecha_emision == null ? null : String(c.fecha_emision).slice(0, 10),
        fecha_cobro: (c.fecha_cobro_real ?? c.fecha_cobro_prevista) == null
          ? null
          : String(c.fecha_cobro_real ?? c.fecha_cobro_prevista).slice(0, 10),
        observacion: c.observacion == null ? null : String(c.observacion),
      });
    }

    // Facturas del mes que todavía no tienen cheque: se proyectan igual.
    for (const f of facturas.values()) {
      if (f.pagada) continue;
      if (facturaConCheque.has(f.numero_control)) continue;
      if (f.fecha_pago < desde || f.fecha_pago > hasta) continue;
      const dia = Number(f.fecha_pago.slice(8, 10));
      if (!dia) continue;
      const fila = filaDe(f.proveedor_id, f.proveedor_nombre, f.moneda);
      const moneda = fila.es_varios ? "PYG" : f.moneda;
      // En la fila VARIOS todo se expresa en guaraníes.
      const importe = fila.es_varios && f.moneda === "USD" ? f.importe * tipoCambio : f.importe;

      push(fila, dia, {
        tipo: "factura",
        cheque_id: null,
        estado: "pendiente_emision",
        moneda,
        importe,
        importe_gs: moneda === "USD" ? importe * tipoCambio : importe,
        numero_factura: f.numero_factura,
        numero_control: f.numero_control,
        facturas: [{ numero_control: f.numero_control, numero_factura: f.numero_factura, importe_imputado: f.importe }],
        numero_cheque: null,
        banco_nombre: null,
        fecha_emision: null,
        fecha_cobro: null,
        observacion: null,
      });
    }

    // ── Totales por día y acumulado.
    const totales: TotalesDia[] = [];
    let acumulado = fondos;
    let totalUsd = 0, totalGs = 0;
    for (let d = 1; d <= diasDelMes; d++) {
      let usd = 0, gs = 0;
      for (const fila of filas.values()) {
        for (const e of fila.dias[d] ?? []) {
          if (e.estado === "cobrado" || e.estado === "anulado") continue;
          if (e.moneda === "USD") usd += e.importe;
          else gs += e.importe;
        }
      }
      const egreso = usd * tipoCambio + gs;
      acumulado -= egreso;
      totalUsd += usd; totalGs += gs;
      totales.push({
        dia: d,
        subtotal_usd: usd,
        subtotal_gs: gs,
        egreso_gs: egreso,
        acumulado_gs: acumulado,
        acumulado_usd: tipoCambio > 0 ? acumulado / tipoCambio : 0,
      });
    }

    const ordenadas = [...filas.values()].sort((a, b) => {
      // VARIOS siempre al final, como en la planilla.
      if (a.es_varios !== b.es_varios) return a.es_varios ? 1 : -1;
      return a.nombre.localeCompare(b.nombre, "es");
    });

    // ── Diagnóstico: por qué la grilla puede estar vacía.
    const porMes = new Map<string, { anio: number; mes: number; cantidad: number }>();
    let fueraDelMes = 0;
    for (const f of facturas.values()) {
      if (f.pagada) continue;
      const a = Number(f.fecha_pago.slice(0, 4));
      const m = Number(f.fecha_pago.slice(5, 7));
      if (!a || !m) continue;
      if (f.fecha_pago < desde || f.fecha_pago > hasta) fueraDelMes += 1;
      const k = `${a}-${m}`;
      const prev = porMes.get(k);
      if (prev) prev.cantidad += 1;
      else porMes.set(k, { anio: a, mes: m, cantidad: 1 });
    }
    const diagnostico: DiagnosticoFlujo = {
      compras_total: todasLasFacturas.size,
      compras_credito: facturas.size,
      fuera_del_mes: fueraDelMes,
      meses_con_pagos: [...porMes.values()].sort((x, y) => x.anio - y.anio || x.mes - y.mes),
    };

    const payload: FlujoCajaMes = {
      config: {
        anio, mes, tipo_cambio: tipoCambio, fondos_disponibles: fondos,
        observacion: cfgQ.data?.observacion == null ? null : String(cfgQ.data.observacion),
      },
      dias: diasDelMes,
      filas: ordenadas,
      totales,
      resumen: {
        total_usd: totalUsd,
        total_gs: totalGs,
        egreso_total_gs: totalUsd * tipoCambio + totalGs,
        acumulado_final_gs: acumulado,
      },
      liquidez: {
        // Informativo: la foto sobre la que se apoya el flujo.
        origen: saldos.length > 0 ? "saldos" : "manual",
        total_gs: fondos,
        mercaderia_gs: mercaderiaGs,
        detalle: saldos.map((s) => ({
          tipo: String(s.tipo) as TipoSaldo,
          descripcion: String(s.descripcion ?? ""),
          moneda: String(s.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG",
          importe: num(s.importe),
        })),
      },
      diagnostico,
    };
    return NextResponse.json(successResponse(payload));
  } catch (err) {
    console.error("[/api/flujo-caja GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse(mensajeErrorFlujo(err, "No se pudo cargar el flujo de caja")),
      { status: 500 }
    );
  }
}

/** PUT /api/flujo-caja — tipo de cambio y fondos del mes. */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const o = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    const anio = Number(o.anio), mes = Number(o.mes);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return NextResponse.json(errorResponse("Período inválido."), { status: 400 });
    }
    const tipoCambio = num(o.tipo_cambio);
    if (tipoCambio < 0) {
      return NextResponse.json(errorResponse("El tipo de cambio no puede ser negativo."), { status: 400 });
    }

    const fila = {
      empresa_id: ctx.auth.empresa_id,
      anio, mes,
      tipo_cambio: tipoCambio,
      fondos_disponibles: num(o.fondos_disponibles),
      observacion: o.observacion == null || String(o.observacion).trim() === ""
        ? null : String(o.observacion).slice(0, 1000),
    };
    const { data, error } = await ctx.supabase
      .from("flujo_caja_config")
      .upsert(fila, { onConflict: "empresa_id,anio,mes" })
      .select("anio, mes, tipo_cambio, fondos_disponibles, observacion")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ config: data }));
  } catch (err) {
    console.error("[/api/flujo-caja PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse(mensajeErrorFlujo(err, "No se pudo guardar la configuración")),
      { status: 500 }
    );
  }
}
