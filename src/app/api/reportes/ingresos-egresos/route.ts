import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { aplicarFiltroSucursal, exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/reportes/ingresos-egresos — toda la plata que entró y salió en un
 * rango, sin ser una venta.
 *
 * ── POR QUÉ UNE DOS TABLAS ────────────────────────────────────────────────
 *   Un egreso se carga en dos lugares distintos según qué sea:
 *
 *     `caja_movimientos` — plata que sale del cajón en un turno: el flete que
 *       se pagó en el momento, el retiro a la bóveda, el vuelto que faltaba.
 *       Está atada a una caja y a un turno.
 *
 *     `gastos` — la factura de gasto: alquiler, luz, el proveedor de
 *       servicios. No necesita que haya una caja abierta y lleva el desglose
 *       de IVA que pide el contador.
 *
 *   Las dos son correctas y ninguna sobra. Lo que faltaba era poder verlas
 *   juntas: preguntar "¿cuánto se gastó esta semana?" obligaba a sumar a mano
 *   los turnos de Cierres de caja más la pantalla de Gastos.
 *
 * ── QUÉ NO ESTÁ ACÁ ───────────────────────────────────────────────────────
 *   Las ventas. Tienen su propio informe y meterlas acá taparía todo lo
 *   demás: al lado de la facturación del mes, un flete de 50.000 no se ve.
 *   Los ingresos que sí entran son los manuales de caja: un aporte, un
 *   reintegro, la devolución de un adelanto.
 *
 * Parámetros: desde, hasta (YYYY-MM-DD, en hora de Paraguay, inclusive).
 */
export const dynamic = "force-dynamic";

/** Paraguay es UTC−3 todo el año; la tzdata del servidor puede estar vieja. */
const OFFSET_PY = "-03:00";

export interface MovimientoUnificado {
  id: string;
  /** De qué tabla salió: cambia qué datos tiene y dónde se corrige. */
  origen: "caja" | "gasto";
  fecha: string;
  /** ingreso | egreso | retiro | ajuste. Un gasto es siempre un egreso. */
  tipo: string;
  /** Clase de egreso (caja) o categoría (gasto). */
  clase: string | null;
  concepto: string;
  /** A quién se le pagó. Solo en gastos. */
  beneficiario: string | null;
  medio_pago: string | null;
  usuario: string | null;
  observacion: string | null;
  numero_factura: string | null;
  monto: number;
  /** Signo ya resuelto: lo que suma es +, lo que resta es −. */
  signo: 1 | -1;
  /** Número de caja del turno, cuando viene de caja. */
  caja_numero: number | null;
  /** Cuántos papeles tiene adjuntos (factura, recibo). */
  adjuntos: number;
  /** Desglose de IVA, solo en gastos. */
  iva: { exenta: number; gravado_5: number; iva_5: number; gravado_10: number; iva_10: number } | null;
}

const n = (v: unknown): number => Number(v) || 0;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sucursalId = exigirSucursal(ctx.auth.sucursal_id);
    const sp = new URL(request.url).searchParams;

    const desde = (sp.get("desde") ?? "").trim();
    const hasta = (sp.get("hasta") ?? "").trim();
    // El día "hasta" entra entero: quien pide del 1 al 31 espera que el 31
    // esté incluido, no que corte a la medianoche del 30.
    const ini = desde ? `${desde}T00:00:00${OFFSET_PY}` : null;
    const fin = hasta ? `${hasta}T23:59:59.999${OFFSET_PY}` : null;

    // ── Movimientos de caja ───────────────────────────────────────────────
    let movQ = aplicarFiltroSucursal(
      ctx.supabase
        .from("caja_movimientos")
        .select(
          "id, caja_id, tipo, concepto, monto, medio_pago, usuario_email, observacion, created_at, tipo_egreso, adjuntos"
        )
        .eq("empresa_id", empresaId)
        // Los anulados no son plata que se movió: ensucian el total.
        .is("anulado_at", null),
      sucursalId
    );
    if (ini) movQ = movQ.gte("created_at", ini);
    if (fin) movQ = movQ.lte("created_at", fin);
    const mov = await movQ.order("created_at", { ascending: false }).limit(5000);
    if (mov.error) throw new Error(mov.error.message);
    const movRows = (mov.data ?? []) as unknown as Array<Record<string, unknown>>;

    // Número de caja de cada turno, en una sola consulta.
    const cajaIds = [...new Set(movRows.map((m) => String(m.caja_id ?? "")).filter(Boolean))];
    const numeroPorCaja = new Map<string, number>();
    if (cajaIds.length) {
      const cQ = await ctx.supabase
        .from("cajas")
        .select("id, numero_caja")
        .eq("empresa_id", empresaId)
        .in("id", cajaIds.slice(0, 1000));
      for (const c of (cQ.data ?? []) as Array<{ id: string; numero_caja: number }>) {
        numeroPorCaja.set(c.id, c.numero_caja);
      }
    }

    // ── Gastos con factura ────────────────────────────────────────────────
    let gasQ = aplicarFiltroSucursal(
      ctx.supabase
        .from("gastos")
        .select(
          "id, fecha, categoria, descripcion, beneficiario, metodo_pago, numero_factura, monto, monto_exenta, gravado_5, iva_5, gravado_10, iva_10"
        )
        .eq("empresa_id", empresaId),
      sucursalId
    );
    if (ini) gasQ = gasQ.gte("fecha", ini);
    if (fin) gasQ = gasQ.lte("fecha", fin);
    const gas = await gasQ.order("fecha", { ascending: false }).limit(5000);
    if (gas.error) throw new Error(gas.error.message);
    const gasRows = (gas.data ?? []) as unknown as Array<Record<string, unknown>>;

    const filas: MovimientoUnificado[] = [
      ...movRows.map((m) => {
        const tipo = String(m.tipo ?? "");
        const entra = tipo === "ingreso";
        return {
          id: String(m.id),
          origen: "caja" as const,
          fecha: String(m.created_at),
          tipo,
          clase: txt(m.tipo_egreso),
          concepto: String(m.concepto ?? ""),
          beneficiario: null,
          medio_pago: txt(m.medio_pago),
          usuario: txt(m.usuario_email),
          observacion: txt(m.observacion),
          numero_factura: null,
          monto: n(m.monto),
          // Un ajuste puede ir para cualquier lado; se cuenta como entrada
          // porque es como lo guarda la caja, y se deja ver aparte.
          signo: (entra || tipo === "ajuste" ? 1 : -1) as 1 | -1,
          caja_numero: numeroPorCaja.get(String(m.caja_id ?? "")) ?? null,
          adjuntos: Array.isArray(m.adjuntos) ? m.adjuntos.length : 0,
          iva: null,
        };
      }),
      ...gasRows.map((g) => ({
        id: String(g.id),
        origen: "gasto" as const,
        fecha: String(g.fecha),
        tipo: "egreso",
        clase: txt(g.categoria),
        concepto: String(g.descripcion ?? ""),
        beneficiario: txt(g.beneficiario),
        medio_pago: txt(g.metodo_pago),
        usuario: null,
        observacion: null,
        numero_factura: txt(g.numero_factura),
        monto: n(g.monto),
        signo: -1 as const,
        caja_numero: null,
        adjuntos: 0,
        iva: {
          exenta: n(g.monto_exenta),
          gravado_5: n(g.gravado_5),
          iva_5: n(g.iva_5),
          gravado_10: n(g.gravado_10),
          iva_10: n(g.iva_10),
        },
      })),
    ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

    const totales = filas.reduce(
      (t, f) => {
        if (f.signo === 1) t.ingresos += f.monto;
        else t.egresos += f.monto;
        if (f.origen === "caja") t.de_caja += f.signo * f.monto;
        else t.de_gastos += f.monto;
        return t;
      },
      { ingresos: 0, egresos: 0, de_caja: 0, de_gastos: 0 }
    );

    return NextResponse.json(
      successResponse({
        desde,
        hasta,
        filas,
        totales: { ...totales, neto: totales.ingresos - totales.egresos },
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/reportes/ingresos-egresos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los ingresos y egresos."), { status: 500 });
  }
}
