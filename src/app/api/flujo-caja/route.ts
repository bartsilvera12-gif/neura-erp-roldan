import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { mensajeErrorFlujo } from "@/lib/flujo-caja/errores";
import { traerTodas } from "@/lib/supabase/traer-todo";
import { desdeIndice, fondosConArrastre, indiceMes } from "@/lib/flujo-caja/arrastre";
import type { EntradaArrastre } from "@/lib/flujo-caja/arrastre";
import { aGuaranies } from "@/lib/moneda";
import type {
  CobranzaProyectada, DiagnosticoFlujo, EntradaFlujo, EstadoCheque, FilaFlujo, FlujoCajaMes,
  MonedaFlujo, TipoSaldo, TotalesDia,
} from "@/lib/flujo-caja/types";

/**
 * Cuántos meses hacia atrás se busca el último mes con fondos cargados, para
 * arrastrar su cierre. Doce es un año: más atrás que eso, un saldo arrastrado
 * ya no dice nada útil y conviene que la pantalla pida cargar la liquidez.
 */
const VENTANA_ARRASTRE_MESES = 12;

/**
 * Margen de días que se le pide de más a la base al traer compras.
 *
 * La fecha de pago es `fecha_factura + plazo_dias` y no es una columna, así que
 * el recorte fino va en memoria. Pero el grueso tiene que ir en la base: el
 * plazo más largo cargado es de 90 días, y con 400 entra cualquier plazo que
 * alguien invente sin que se escape una factura.
 */
const MARGEN_PLAZO_DIAS = 400;

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

    // ── Config y saldos de toda la ventana de arrastre ─────────────────────
    //    No alcanza con el mes que se está mirando: si no tiene fondos propios
    //    hay que poder llegar hasta el último mes que sí los tenga, y aplicarle
    //    los netos de todos los meses del medio.
    const indiceObjetivo = indiceMes(anio, mes);
    const inicioVentana = desdeIndice(indiceObjetivo - VENTANA_ARRASTRE_MESES);

    const cfgsQ = await ctx.supabase
      .from("flujo_caja_config")
      .select("anio, mes, fondos_disponibles")
      .eq("empresa_id", empresaId)
      .gte("anio", inicioVentana.anio)
      .lte("anio", anio);
    if (cfgsQ.error) throw new Error(cfgsQ.error.message);
    /** Monto manual por mes. Un cero no cuenta: es "no cargado", no "no tengo plata". */
    const fondosManualPorMes = new Map<number, number>();
    for (const c of (cfgsQ.data ?? []) as Array<Record<string, unknown>>) {
      const monto = num(c.fondos_disponibles);
      if (monto !== 0) fondosManualPorMes.set(indiceMes(Number(c.anio), Number(c.mes)), monto);
    }

    const saldosQ = await ctx.supabase
      .from("flujo_caja_saldos")
      .select("anio, mes, tipo, descripcion, moneda, importe")
      .eq("empresa_id", empresaId)
      .gte("anio", inicioVentana.anio)
      .lte("anio", anio);
    if (saldosQ.error) throw new Error(saldosQ.error.message);
    const saldosPorMes = new Map<number, Array<Record<string, unknown>>>();
    for (const s of (saldosQ.data ?? []) as Array<Record<string, unknown>>) {
      const k = indiceMes(Number(s.anio), Number(s.mes));
      if (!saldosPorMes.has(k)) saldosPorMes.set(k, []);
      saldosPorMes.get(k)!.push(s);
    }

    /**
     * La posición de liquidez de un mes, en guaraníes.
     *
     * La MERCADERÍA no entra en los fondos: es plata inmovilizada en stock, no
     * plata con la que se pueda firmar un cheque.
     */
    const liquidezDe = (indice: number) => {
      const filas = saldosPorMes.get(indice) ?? [];
      let liquidez = 0, mercaderia = 0;
      for (const s of filas) {
        const enGs = String(s.moneda ?? "PYG").toUpperCase() === "USD"
          ? aGuaranies(s.importe, tipoCambio)
          : num(s.importe);
        if (String(s.tipo) === "mercaderia") mercaderia += enGs;
        else liquidez += enGs;
      }
      return { liquidez, mercaderia, filas };
    };

    const liquidezDelMes = liquidezDe(indiceObjetivo);
    const saldos = liquidezDelMes.filas;
    const mercaderiaGs = liquidezDelMes.mercaderia;

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

    // ── Compras a crédito de la ventana ───────────────────────────────────
    //
    // ANTES ESTO ESTABA MAL Y NO SE NOTABA. La consulta pedía TODAS las compras
    // de la empresa sin `limit` y sin paginar. PostgREST corta en 1000 filas y
    // no avisa: devolvía mil de 16.373 y la grilla del mes se armaba con esa
    // muestra. Mil filas parecen muchas, así que la pantalla se veía bien.
    //
    // Ahora se filtra en la base por lo que de verdad hace falta —solo crédito,
    // solo la ventana de fechas— y lo que queda se trae paginado y completo.
    const ventanaDesde = sumarDias(
      `${inicioVentana.anio}-${String(inicioVentana.mes).padStart(2, "0")}-01`,
      -MARGEN_PLAZO_DIAS
    );
    // Hacia adelante también: el diagnóstico tiene que poder decir "los pagos
    // caen en diciembre" y mandarte ahí. Con 30 días de plazo, la factura de
    // hoy se paga el mes que viene, que es el error de prueba más común.
    const ventanaHasta = sumarDias(hasta, MARGEN_PLAZO_DIAS);

    const comprasFilas = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("compras")
        .select("numero_control, numero_factura, proveedor_id, proveedor_nombre, fecha, fecha_factura, plazo_dias, total, moneda, tipo_cambio, estado, tipo_pago")
        .eq("empresa_id", empresaId)
        .eq("tipo_pago", "credito")
        .not("estado", "in", '("anulada")')
        .gte("fecha", ventanaDesde)
        .lte("fecha", ventanaHasta)
        // Orden estable: sin esto dos páginas seguidas pueden repetir y saltear.
        .order("numero_control", { ascending: true })
        .range(d, h)
    );

    // El diagnóstico necesita saber si hay ALGO cargado, para distinguir "no hay
    // compras" de "ninguna es a crédito". Es una cuenta, no una descarga.
    const totalComprasQ = await ctx.supabase
      .from("compras")
      .select("numero_control", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .not("estado", "in", '("anulada")');
    if (totalComprasQ.error) throw new Error(totalComprasQ.error.message);

    /** Una factura = N filas de `compras` con el mismo numero_control. */
    type Factura = {
      numero_control: string; numero_factura: string | null;
      proveedor_id: string; proveedor_nombre: string;
      fecha_pago: string; moneda: MonedaFlujo; importe: number; pagada: boolean;
    };
    const facturas = new Map<string, Factura>();
    /** Toda factura no anulada, a crédito o no. Solo sirve para el diagnóstico. */
    const todasLasFacturas = new Set<string>();
    for (const r of comprasFilas) {
      const nc = String(r.numero_control ?? "");
      if (!nc) continue;
      todasLasFacturas.add(nc);
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

    // ── Cheques de la ventana ──────────────────────────────────────────────
    //    Se traen los de toda la ventana, no solo los del mes, por dos motivos:
    //    el arrastre necesita los netos de los meses anteriores, y una factura
    //    cubierta por un cheque de OTRO mes no se tiene que volver a proyectar
    //    acá (antes sí pasaba: se la contaba dos veces).
    const inicioVentanaIso = `${inicioVentana.anio}-${String(inicioVentana.mes).padStart(2, "0")}-01`;
    const chequesTodos = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("cheques")
        .select("id, proveedor_id, proveedor_nombre, numero, banco_nombre, moneda, importe, estado, fecha_pago_prevista, fecha_emision, fecha_cobro_real, fecha_cobro_prevista, observacion")
        .eq("empresa_id", empresaId)
        .gte("fecha_pago_prevista", inicioVentanaIso)
        .lte("fecha_pago_prevista", hasta)
        .order("id", { ascending: true })
        .range(d, h)
    );
    /** Los del mes que se está mirando: son los que van a la grilla. */
    const cheques = chequesTodos.filter((c) => {
      const fp = String(c.fecha_pago_prevista ?? "").slice(0, 10);
      return fp >= desde && fp <= hasta;
    });

    const chequeIds = chequesTodos.map((c) => String(c.id));
    const porCheque = new Map<string, { numero_control: string; importe_imputado: number }[]>();
    const facturaConCheque = new Set<string>();
    if (chequeIds.length > 0) {
      const ccQ = await ctx.supabase
        .from("cheque_compras")
        .select("cheque_id, compra_numero_control, importe_imputado")
        .eq("empresa_id", empresaId)
        .in("cheque_id", chequeIds)
        .limit(10_000);
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
        importe_gs: moneda === "USD" ? aGuaranies(importe, tipoCambio) : importe,
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
      const importe = fila.es_varios && f.moneda === "USD" ? aGuaranies(f.importe, tipoCambio) : f.importe;

      push(fila, dia, {
        tipo: "factura",
        cheque_id: null,
        estado: "pendiente_emision",
        moneda,
        importe,
        importe_gs: moneda === "USD" ? aGuaranies(importe, tipoCambio) : importe,
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

    // ── Cobranzas: la plata que ENTRA ─────────────────────────────────────
    //
    // Hasta acá el Disponible solo restaba pagos a proveedores. Un flujo de caja
    // de una sola dirección contesta "cuánto me queda si no cobro nada en todo
    // el mes", que no es una pregunta que alguien se haga. La plata que entra ya
    // estaba en la base, en cuentas por cobrar, sin usarse.
    //
    // No se filtra por estado: las cobradas hacen falta para los netos de los
    // meses anteriores (el arrastre), y las pendientes para la proyección.
    const cxcFilas = await traerTodas<Record<string, unknown>>((d, h) =>
      ctx.supabase
        .from("cuentas_por_cobrar")
        .select("id, cliente_id, numero_venta, fecha_vencimiento, moneda, total, saldo, estado")
        .eq("empresa_id", empresaId)
        .not("estado", "in", '("anulado")')
        .lte("fecha_vencimiento", hasta)
        .order("id", { ascending: true })
        .range(d, h)
    );

    const enGuaranies = (importe: number, moneda: unknown): number =>
      String(moneda ?? "PYG").toUpperCase() === "USD" ? aGuaranies(importe, tipoCambio) : importe;

    /** Lo que vence en el mes y todavía no está cobrado, día por día. */
    const cobranzasPorDia: Record<number, CobranzaProyectada[]> = {};
    /** Venció ANTES del mes y sigue sin cobrarse. Va aparte, no al Disponible. */
    let cobranzasVencidasGs = 0;
    for (const r of cxcFilas) {
      const venc = String(r.fecha_vencimiento ?? "").slice(0, 10);
      if (!venc) continue;
      const estado = String(r.estado ?? "");
      const porCobrar = num(r.saldo);
      if (porCobrar <= 0) continue; // ya se cobró entera

      if (venc < desde) { cobranzasVencidasGs += enGuaranies(porCobrar, r.moneda); continue; }
      if (venc > hasta) continue;

      const dia = Number(venc.slice(8, 10));
      if (!dia) continue;
      if (!cobranzasPorDia[dia]) cobranzasPorDia[dia] = [];
      cobranzasPorDia[dia].push({
        cuenta_id: String(r.id),
        cliente_nombre: String(r.cliente_id ?? ""), // se reemplaza por el nombre abajo
        numero_venta: r.numero_venta == null ? null : String(r.numero_venta),
        saldo: porCobrar,
        moneda: String(r.moneda ?? "PYG").toUpperCase() === "USD" ? "USD" : "PYG",
        estado,
        fecha_vencimiento: venc,
      });
    }

    // Los nombres de los clientes que aparecen en el mes. Un id no le dice nada
    // a nadie, y son pocos: solo los del mes.
    const idsClientes = [...new Set(
      Object.values(cobranzasPorDia).flat().map((c) => c.cliente_nombre).filter(Boolean)
    )];
    if (idsClientes.length > 0) {
      const clientesQ = await ctx.supabase
        .from("clientes")
        .select("id, nombre")
        .eq("empresa_id", empresaId)
        .in("id", idsClientes.slice(0, 1000));
      if (clientesQ.error) throw new Error(clientesQ.error.message);
      const nombres = new Map<string, string>();
      for (const c of (clientesQ.data ?? []) as Array<Record<string, unknown>>) {
        nombres.set(String(c.id), String(c.nombre ?? ""));
      }
      for (const lista of Object.values(cobranzasPorDia)) {
        for (const c of lista) c.cliente_nombre = nombres.get(c.cliente_nombre) || "—";
      }
    }

    // ── Netos de los meses anteriores, para encadenar el arrastre ──────────
    //    Es una PROYECCIÓN: lo que estaba previsto cobrar y pagar en cada mes,
    //    no lo que de verdad pasó por el banco. Por eso la posición de liquidez
    //    tiene más prioridad: cargarla es la forma de volver a poner la
    //    pantalla en hora.
    const egresoPorMes = new Map<number, number>();
    const ingresoPorMes = new Map<number, number>();
    const sumar = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);

    for (const c of chequesTodos) {
      const estado = String(c.estado ?? "");
      // Acá los COBRADOS sí cuentan, al revés que en la grilla del mes. No es
      // una contradicción: en la grilla se proyecta lo que FALTA pagar, y un
      // cheque cobrado ya no falta. Para el saldo con que cerró un mes pasado,
      // en cambio, ese cheque salió del banco y tiene que restar.
      if (estado === "anulado") continue;
      const fp = String(c.fecha_pago_prevista ?? "").slice(0, 10);
      if (!fp) continue;
      sumar(egresoPorMes, indiceMes(Number(fp.slice(0, 4)), Number(fp.slice(5, 7))),
        enGuaranies(num(c.importe), c.moneda));
    }
    for (const f of facturas.values()) {
      if (f.pagada) continue;
      if (facturaConCheque.has(f.numero_control)) continue;
      sumar(egresoPorMes, indiceMes(Number(f.fecha_pago.slice(0, 4)), Number(f.fecha_pago.slice(5, 7))),
        enGuaranies(f.importe, f.moneda));
    }
    for (const r of cxcFilas) {
      const venc = String(r.fecha_vencimiento ?? "").slice(0, 10);
      if (!venc) continue;
      // Para los meses ya pasados vale lo que se esperaba cobrar, cobrado o no:
      // es la misma proyección con la que se calculó el egreso.
      sumar(ingresoPorMes, indiceMes(Number(venc.slice(0, 4)), Number(venc.slice(5, 7))),
        enGuaranies(num(r.total), r.moneda));
    }

    // ── Fondos con los que abre el mes ────────────────────────────────────
    const datosDelMes = (a: number, m: number): EntradaArrastre => {
      const i = indiceMes(a, m);
      const liq = liquidezDe(i);
      const manual = fondosManualPorMes.get(i);
      return {
        propios: liq.filas.length > 0 ? liq.liquidez : (manual ?? null),
        origenPropios: liq.filas.length > 0 ? "saldos" : "manual",
        neto: { ingresos: ingresoPorMes.get(i) ?? 0, egresos: egresoPorMes.get(i) ?? 0 },
      };
    };
    const arrastre = fondosConArrastre(anio, mes, datosDelMes, VENTANA_ARRASTRE_MESES);
    const fondos = arrastre.fondos;

    // ── Totales por día y acumulado.
    const totales: TotalesDia[] = [];
    let acumulado = fondos;
    let totalUsd = 0, totalGs = 0, ingresoTotalGs = 0;
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
      const ingreso = (cobranzasPorDia[d] ?? []).reduce(
        (sum, c) => sum + enGuaranies(c.saldo, c.moneda), 0);
      acumulado += ingreso - egreso;
      totalUsd += usd; totalGs += gs; ingresoTotalGs += ingreso;
      totales.push({
        dia: d,
        subtotal_usd: usd,
        subtotal_gs: gs,
        egreso_gs: egreso,
        ingreso_gs: ingreso,
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
      compras_total: totalComprasQ.count ?? todasLasFacturas.size,
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
      cobranzas: cobranzasPorDia,
      resumen: {
        total_usd: totalUsd,
        total_gs: totalGs,
        egreso_total_gs: totalUsd * tipoCambio + totalGs,
        ingreso_total_gs: ingresoTotalGs,
        cobranzas_vencidas_gs: cobranzasVencidasGs,
        acumulado_final_gs: acumulado,
      },
      liquidez: {
        // De dónde salieron los fondos iniciales. La pantalla lo dice en texto:
        // un saldo arrastrado y uno contado no se leen igual.
        origen: arrastre.origen,
        arrastre_de: arrastre.arrastre_de,
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
