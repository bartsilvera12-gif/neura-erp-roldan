"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ExportarTablaButton from "@/components/ui/ExportarTablaButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { Banknote, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { generarYAbrirRecibo } from "@/lib/recibos/client";
import { RegistrarCobroModalCxc } from "@/components/cobros/RegistrarCobroModalCxc";
import {
  ToggleNutricionConsig,
  useModoPersistido,
} from "@/components/ui/ToggleNutricionConsig";

/** Filtro de situación de las cuentas por cobrar (punto 10.3). */
type Situacion = "todas" | "vencidas" | "al_dia";

type Cuenta = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  /** Punto 10.3: CLI-00001, lo que se dice por teléfono. Null sin el script 28. */
  cliente_codigo?: string | null;
  venta_id: string;
  numero_venta: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  moneda: string;
  total: number;
  saldo: number;
  estado: string;
  vencida: boolean;
};
type Cobro = {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string;
  numero_venta: string | null;
  fecha_pago: string | null;
  monto: number;
  metodo_pago: string;
  referencia: string | null;
  usuario_nombre: string | null;
  anulado?: boolean;
  anulado_motivo?: string | null;
  anulado_por?: string | null;
};
type PorPagar = {
  id: string;
  numero_control: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  fecha_factura: string | null;
  plazo_dias: number | null;
  total: number;
  estado: string;
  moneda: string;
  items: number;
  fecha_vencimiento: string | null;
  vencida: boolean;
  /** Total bruto antes de notas de crédito (opcional). */
  total_bruto?: number;
  /** Suma de notas de crédito de compra imputadas a esta compra. */
  nc_aplicado?: number;
};

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  parcial: "bg-sky-100 text-sky-700",
  pagado: "bg-emerald-100 text-emerald-700",
  vencido: "bg-red-100 text-red-700",
  anulado: "bg-slate-100 text-slate-500",
};
const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro",
};

function fmtGs(n: number, moneda = "PYG") {
  return (moneda === "USD" ? "USD " : "Gs. ") + Math.round(Number(n) || 0).toLocaleString("es-PY");
}
function ymd(iso: string | null): string {
  if (!iso) return "";
  return String(iso).slice(0, 10);
}
function fmtFecha(iso: string | null) {
  const s = ymd(iso);
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

const inputClass = "rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";

export default function PagosPage() {
  const [modo, setModo] = useModoPersistido("pagos.modo");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [porPagar, setPorPagar] = useState<PorPagar[]>([]);
  const [pagarTarget, setPagarTarget] = useState<PorPagar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pendientes" | "cobrados" | "por_pagar">("pendientes");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [buscar, setBuscar] = useState("");
  const [situacion, setSituacion] = useState<Situacion>("todas");
  const [toast, setToast] = useState<string | null>(null);
  // Requisito 11.4: el botón de anular un cobro solo para administradores.
  const { isAdmin: esAdmin } = useIsAdmin();

  const [cobrando, setCobrando] = useState<Cuenta | null>(null);
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [reversarBusy, setReversarBusy] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Cuentas por COBRAR: filtran por ventas.origen (Nutrición vs Consignataria).
      const qs = `?origen=${encodeURIComponent(modo)}`;
      // Cuentas por PAGAR (compras a proveedores): son un flujo global de nutrición,
      // no dependen del toggle. Se piden SIEMPRE con origen=nutricion para que la
      // pestaña "Por Pagar" (programación de pagos + notas de crédito de compra)
      // funcione aunque el usuario tenga el toggle en Consignataria.
      const [res, resPP] = await Promise.all([
        fetchWithSupabaseSession(`/api/cobros/cuentas${qs}`, { cache: "no-store" }),
        fetchWithSupabaseSession(`/api/pagos/por-pagar?origen=nutricion`, { cache: "no-store" }),
      ]);
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudieron cargar las cobranzas.");
        return;
      }
      setCuentas((body.data?.cuentas ?? []) as Cuenta[]);
      setCobros((body.data?.cobros ?? []) as Cobro[]);
      const bodyPP = await resPP.json().catch(() => ({}));
      if (resPP.ok && bodyPP?.success !== false) {
        setPorPagar((bodyPP.data?.porPagar ?? []) as PorPagar[]);
      }
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, [modo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Abre la orden de pago imprimible (fetch con sesión → nueva ventana).
  async function abrirOrdenPago(numeroControl: string) {
    try {
      const res = await fetchWithSupabaseSession(`/api/compras/orden-pago?numero_control=${encodeURIComponent(numeroControl)}`);
      if (!res.ok) { alert("No se pudo generar la orden de pago."); return; }
      const html = await res.text();
      const w = window.open("", "_blank");
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    } catch {
      alert("No se pudo generar la orden de pago.");
    }
  }

  // Punto 10.3, "filtros amplios": además del rango de fechas, buscar por
  // cliente, por código de cliente o por número de factura, y acotar por
  // situación. Son las tres formas en que alguien llega a una deuda: con el
  // nombre, con el papel en la mano, o preguntando qué está vencido.
  const texto = buscar.trim().toLowerCase();
  const coincideTexto = useCallback(
    (...campos: (string | null | undefined)[]) =>
      !texto || campos.some((c) => (c ?? "").toLowerCase().includes(texto)),
    [texto]
  );

  const enRango = useCallback(
    (fecha: string | null) => {
      const f = ymd(fecha);
      if (!f) return !desde && !hasta;
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      return true;
    },
    [desde, hasta]
  );

  // Pendientes = cuentas con saldo > 0 (incluye parciales). Filtro por emisión o vencimiento.
  const pendientes = useMemo(
    () =>
      cuentas
        .filter((c) => c.saldo > 0 && c.estado !== "anulado")
        .filter((c) => (!desde && !hasta) ? true : (enRango(c.fecha_emision) || enRango(c.fecha_vencimiento)))
        .filter((c) => coincideTexto(c.cliente_nombre, c.cliente_codigo, c.numero_venta))
        .filter((c) => situacion === "todas" || (situacion === "vencidas" ? c.vencida : !c.vencida)),
    [cuentas, desde, hasta, enRango, coincideTexto, situacion]
  );
  // Cobrados = historial de pagos. Filtro por fecha de pago.
  const cobradosVista = useMemo(
    () =>
      cobros
        .filter((c) => (!desde && !hasta) ? true : enRango(c.fecha_pago))
        .filter((c) => coincideTexto(c.cliente_nombre, c.numero_venta, c.referencia)),
    [cobros, desde, hasta, enRango, coincideTexto]
  );
  // Por pagar = compras crédito no pagadas. Filtro por fecha compra o vencimiento.
  const porPagarVista = useMemo(
    () => porPagar.filter((c) => (!desde && !hasta) ? true : (enRango(c.fecha) || enRango(c.fecha_vencimiento))),
    [porPagar, desde, hasta, enRango]
  );
  const sumPP = useMemo(() => porPagarVista.reduce((a, c) => a + c.total, 0), [porPagarVista]);

  const sumPend = useMemo(
    () => pendientes.reduce((a, c) => ({ total: a.total + c.total, saldo: a.saldo + c.saldo }), { total: 0, saldo: 0 }),
    [pendientes]
  );
  const sumCob = useMemo(() => cobradosVista.reduce((a, c) => a + c.monto, 0), [cobradosVista]);

  function abrirCobro(c: Cuenta) {
    setCobrando(c);
  }

  const hayFiltro = !!desde || !!hasta || !!buscar.trim() || situacion !== "todas";

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">✓ {toast}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Banknote className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Cobranzas</p>
            <h1 className="text-2xl font-bold text-gray-800">Pagos</h1>
            <p className="text-sm text-gray-500">Cuentas por cobrar de ventas a crédito y registro de cobros.</p>
          </div>
        </div>
        {/* filtro de fechas */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Situación</label>
            <select value={situacion} onChange={(e) => setSituacion(e.target.value as Situacion)} className={inputClass}>
              <option value="todas">Todas</option>
              <option value="vencidas">Vencidas</option>
              <option value="al_dia">Al día</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Buscar</label>
            <input
              type="text"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Cliente, código o factura"
              className={`${inputClass} w-56`}
            />
          </div>
          {/* Requisito 11.1: la lista de lo que se debe y lo que se cobró,
              con los filtros puestos, en Excel. Es la que se imprime para
              salir a cobrar. */}
          <ExportarTablaButton
            titulo="Cuentas por cobrar"
            archivo={`cuentas-por-cobrar-${desde || "inicio"}_${hasta || "hoy"}`}
            subtitulo={hayFiltro ? `Filtrado · del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
            columnas={["Código", "Cliente", "Factura", "Emisión", "Vencimiento", "Total", "Cobrado", "Saldo", "Vencida"]}
            filas={pendientes.map((c) => [
              c.cliente_codigo ?? "",
              c.cliente_nombre,
              c.numero_venta ?? "",
              ymd(c.fecha_emision) ?? "",
              ymd(c.fecha_vencimiento) ?? "",
              c.total,
              c.total - c.saldo,
              c.saldo,
              c.vencida,
            ])}
          />
          <ExportarTablaButton
            label="Excel cobros"
            titulo="Cobros registrados"
            archivo={`cobros-${desde || "inicio"}_${hasta || "hoy"}`}
            subtitulo={hayFiltro ? `Filtrado · del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
            columnas={["Fecha", "Cliente", "Factura", "Medio", "Comprobante", "Monto", "Cobró", "Anulado", "Motivo"]}
            filas={cobradosVista.map((c) => [
              ymd(c.fecha_pago) ?? "",
              c.cliente_nombre,
              c.numero_venta ?? "",
              c.metodo_pago,
              c.referencia ?? "",
              c.monto,
              c.usuario_nombre ?? "",
              c.anulado ? "SÍ" : "",
              c.anulado_motivo ?? "",
            ])}
          />
          {hayFiltro && (
            <button type="button" onClick={() => { setDesde(""); setHasta(""); setBuscar(""); setSituacion("todas"); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-400">Cuentas con saldo</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{pendientes.length}</div>
          <div className="text-[11px] text-slate-400">de {cuentas.length} en total</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-amber-600">Saldo pendiente</div>
          <div className="mt-1 text-2xl font-bold text-amber-700">{fmtGs(sumPend.saldo)}</div>
          <div className="text-[11px] text-amber-500">Total: {fmtGs(sumPend.total)}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-emerald-600">Cobrado (filtros)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{fmtGs(sumCob)}</div>
          <div className="text-[11px] text-emerald-500">{cobradosVista.length} pagos</div>
        </div>
      </div>

      {/* Pestañas: solo 2 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("pendientes")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "pendientes" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Pendientes <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "pendientes" ? "bg-white/25" : "bg-slate-100"}`}>{pendientes.length}</span>
        </button>
        <button onClick={() => setTab("cobrados")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "cobrados" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cobrados <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "cobrados" ? "bg-white/25" : "bg-slate-100"}`}>{cobradosVista.length}</span>
        </button>
        {/* "Por Pagar" (compras a proveedores) es un flujo global: siempre visible,
            independiente del toggle Nutrición/Consignataria. */}
        <button onClick={() => setTab("por_pagar")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "por_pagar" ? "bg-orange-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Por Pagar <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "por_pagar" ? "bg-white/25" : "bg-orange-100 text-orange-700"}`}>{porPagarVista.length}</span>
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="p-8 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : tab === "pendientes" ? (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {pendientes.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">No hay cuentas pendientes {hayFiltro ? "en el rango seleccionado" : ""}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Emisión</th>
                    <th className="py-3 px-4 font-medium">Vencimiento</th>
                    <th className="py-3 px-4 font-medium text-right">Total</th>
                    <th className="py-3 px-4 font-medium text-right">Cobrado</th>
                    <th className="py-3 px-4 font-medium text-right">Saldo</th>
                    <th className="py-3 px-4 font-medium">Estado</th>
                    <th className="py-3 px-4 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendientes.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-gray-700">
                        <Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link>
                        {c.cliente_codigo && (
                          <div className="font-mono text-[11px] text-slate-400">{c.cliente_codigo}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-gray-800">{c.numero_venta ?? "—"}</td>
                      <td className="py-3 px-4 text-gray-600">{fmtFecha(c.fecha_emision)}</td>
                      <td className={`py-3 px-4 ${c.vencida ? "font-semibold text-red-600" : "text-gray-600"}`}>{fmtFecha(c.fecha_vencimiento)}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{fmtGs(c.total, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-emerald-700">{fmtGs(c.total - c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-amber-600">{fmtGs(c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[c.vencida && c.estado !== "pagado" ? "vencido" : c.estado] ?? ESTADO_BADGE.pendiente}`}>
                          {c.vencida && c.estado !== "pagado" ? "Vencido" : c.estado.charAt(0).toUpperCase() + c.estado.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button onClick={() => abrirCobro(c)} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]">Registrar pago</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={4} className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">Suma de la vista</p>
                      <p className="text-[11px] text-slate-500">{pendientes.length} registro{pendientes.length === 1 ? "" : "s"} · recalcula al cambiar fechas o pestaña</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtGs(sumPend.total)}</p>
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Saldo</span>
                      <p className="text-sm font-bold tabular-nums text-amber-600">{fmtGs(sumPend.saldo)}</p>
                    </td>
                    <td colSpan={2} className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : tab === "cobrados" ? (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {cobradosVista.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">No hay cobros {hayFiltro ? "en el rango seleccionado" : "registrados"}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Fecha</th>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Método</th>
                    <th className="py-3 px-4 font-medium">Referencia</th>
                    <th className="py-3 px-4 font-medium">Registrado por</th>
                    <th className="py-3 px-4 font-medium text-right">Monto</th>
                    <th className="py-3 px-4 font-medium text-right">Recibo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cobradosVista.map((c) => (
                    <tr key={c.id} className={c.anulado ? "bg-rose-50/40" : "hover:bg-slate-50"}>
                      <td className="py-2.5 px-4 text-gray-600">{fmtFecha(c.fecha_pago)}</td>
                      <td className="py-2.5 px-4 text-gray-700">
                        {c.cliente_id ? <Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link> : c.cliente_nombre}
                        {c.anulado && (
                          <div className="text-[11px] text-rose-600">
                            Anulado{c.anulado_por ? ` por ${c.anulado_por}` : ""}
                            {c.anulado_motivo ? `: ${c.anulado_motivo}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-gray-700">{c.numero_venta ?? "—"}</td>
                      <td className="py-2.5 px-4 text-gray-600">{METODO_LABEL[c.metodo_pago] ?? c.metodo_pago}</td>
                      <td className="py-2.5 px-4 text-gray-500">{c.referencia ?? "—"}</td>
                      <td className="py-2.5 px-4 text-gray-600">{c.usuario_nombre ?? "—"}</td>
                      <td className={`py-2.5 px-4 text-right tabular-nums font-semibold ${c.anulado ? "text-slate-400 line-through" : "text-emerald-700"}`}>{fmtGs(c.monto)}</td>
                      <td className="py-2.5 px-4 text-right">
                        {/* Un cobro anulado no lleva recibo ni se vuelve a
                            anular: la plata ya volvió al saldo del cliente. */}
                        {c.anulado ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                        <>
                        <button
                          disabled={reciboBusy === c.id}
                          onClick={async () => {
                            if (reciboBusy) return;
                            setReciboBusy(c.id);
                            try {
                              const r = await generarYAbrirRecibo({ origen: "cobro_cxc", cobro_cliente_id: c.id });
                              if (r.ok) { setToast("Recibo generado"); setTimeout(() => setToast(null), 2500); }
                              else { setError(r.error ?? "No se pudo generar el recibo."); }
                            } finally {
                              setReciboBusy(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {reciboBusy === c.id ? <><Loader2 className="h-3 w-3 animate-spin" /> Abriendo…</> : "Recibo"}
                        </button>
                        {/* Requisito 11.4: anular un cobro mueve la deuda del
                            cliente y la plata del turno. Solo admin; el
                            servidor lo verifica igual. */}
                        {esAdmin && (
                        <button
                          disabled={reversarBusy === c.id}
                          onClick={async () => {
                            if (reversarBusy) return;
                            // El motivo es obligatorio (punto 10.3): el recibo no
                            // se borra, queda anulado con su explicación.
                            const motivo = window.prompt(
                              `Anular el cobro de ${fmtGs(c.monto)} de ${c.cliente_nombre}.\n` +
                              `El monto vuelve al saldo pendiente y el recibo queda en el historial, anulado.\n\n` +
                              `¿Por qué se anula?`
                            );
                            if (motivo === null) return;
                            if (!motivo.trim()) {
                              setError("Hay que escribir el motivo de la anulación.");
                              return;
                            }
                            setReversarBusy(c.id);
                            try {
                              const r = await fetchWithSupabaseSession(
                                `/api/cobros?id=${encodeURIComponent(c.id)}&motivo=${encodeURIComponent(motivo.trim())}`,
                                { method: "DELETE" }
                              );
                              const j = await r.json().catch(() => ({}));
                              if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
                              setToast(
                                j?.data?.compensado_en_caja
                                  ? "Cobro anulado y descontado del turno de caja"
                                  : "Cobro anulado"
                              );
                              setTimeout(() => setToast(null), 2500);
                              await cargar();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "No se pudo anular el cobro.");
                            } finally {
                              setReversarBusy(null);
                            }
                          }}
                          className="ml-2 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {reversarBusy === c.id ? <><Loader2 className="h-3 w-3 animate-spin" /> …</> : "Anular"}
                        </button>
                        )}
                        </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={5} className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">Total cobrado en la vista</p>
                      <p className="text-[11px] text-slate-500">{cobradosVista.length} registro{cobradosVista.length === 1 ? "" : "s"} · recalcula al cambiar fechas</p>
                    </td>
                    <td className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cobrado</td>
                    <td className="px-4 py-3 text-right"><p className="text-sm font-bold tabular-nums text-emerald-700">{fmtGs(sumCob)}</p></td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuentas por pagar a proveedores</p>
            <Link href="/pagos/proveedores" className="rounded-lg border border-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10">
              📊 Estado de cuenta proveedores
            </Link>
          </div>
          {porPagarVista.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">No hay compras a crédito pendientes {hayFiltro ? "en el rango seleccionado" : ""}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Proveedor</th>
                    <th className="py-3 px-4 font-medium">N° Control</th>
                    <th className="py-3 px-4 font-medium">Fecha</th>
                    <th className="py-3 px-4 font-medium">Fact. proveedor</th>
                    <th className="py-3 px-4 font-medium">Plazo</th>
                    <th className="py-3 px-4 font-medium">Vencimiento</th>
                    <th className="py-3 px-4 font-medium text-right">Total</th>
                    <th className="py-3 px-4 font-medium">Estado</th>
                    <th className="py-3 px-4 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porPagarVista.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-gray-700">{c.proveedor_nombre}</td>
                      <td className="py-3 px-4 font-mono text-gray-800">{c.numero_control}</td>
                      <td className="py-3 px-4 text-gray-600">{fmtFecha(c.fecha)}</td>
                      <td className="py-3 px-4 text-gray-600">{fmtFecha(c.fecha_factura)}</td>
                      <td className="py-3 px-4 text-gray-600">{c.plazo_dias ? `${c.plazo_dias}d` : "—"}</td>
                      <td className={`py-3 px-4 ${c.vencida ? "font-semibold text-red-600" : "text-gray-600"}`}>{fmtFecha(c.fecha_vencimiento)}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-orange-700">
                        {fmtGs(c.total, c.moneda)}
                        {(c.nc_aplicado ?? 0) > 0 && (
                          <span className="block text-[11px] font-normal text-violet-600">NC −{fmtGs(c.nc_aplicado ?? 0, c.moneda)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.vencida ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                          {c.vencida ? "Vencida" : (c.estado.charAt(0).toUpperCase() + c.estado.slice(1))}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPagarTarget(c)}
                          className="mr-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Registrar pago
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirOrdenPago(c.numero_control)}
                          className="mr-2 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
                        >
                          Orden de pago
                        </button>
                        <Link href={`/compras`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Ver en Compras
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={6} className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">Total por pagar en la vista</p>
                      <p className="text-[11px] text-slate-500">{porPagarVista.length} compra{porPagarVista.length === 1 ? "" : "s"} · usá &ldquo;Registrar pago&rdquo; para saldarlas</p>
                    </td>
                    <td className="px-4 py-3 text-right"><p className="text-sm font-bold tabular-nums text-orange-700">{fmtGs(sumPP)}</p></td>
                    <td colSpan={2} className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal registrar pago (componente compartido con campos de Transferencia/Tarjeta) */}
      <RegistrarCobroModalCxc
        open={!!cobrando}
        cuenta={cobrando ? { id: cobrando.id, numero_venta: cobrando.numero_venta, saldo: cobrando.saldo, moneda: cobrando.moneda, cliente_nombre: cobrando.cliente_nombre } : null}
        onClose={() => setCobrando(null)}
        onExito={async () => { setToast("Pago registrado"); setTimeout(() => setToast(null), 2800); await cargar(); }}
      />

      {/* Modal registrar pago a PROVEEDOR (compra a crédito) */}
      {pagarTarget && (
        <RegistrarPagoProveedorModal
          compra={pagarTarget}
          onClose={() => setPagarTarget(null)}
          onExito={async () => {
            setPagarTarget(null);
            setToast("Pago al proveedor registrado");
            setTimeout(() => setToast(null), 2800);
            await cargar();
          }}
        />
      )}

    </div>
  );
}

// ── Modal: registrar el pago de una compra a crédito a un proveedor ──────────
function RegistrarPagoProveedorModal({
  compra,
  onClose,
  onExito,
}: {
  compra: PorPagar;
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia" | "tarjeta">("transferencia");
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = (n: number) =>
    (compra.moneda === "USD" ? "USD " : "Gs ") + new Intl.NumberFormat("es-PY").format(Math.round(Number(n) || 0));

  const requiereRef = metodo === "transferencia" || metodo === "tarjeta";

  async function confirmar() {
    setError(null);
    if (requiereRef && !referencia.trim()) {
      setError(metodo === "transferencia" ? "Cargá el N° de comprobante de la transferencia." : "Cargá el N° de ticket de la tarjeta.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithSupabaseSession("/api/compras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: compra.numero_control,
          estado: "pagada",
          metodo_pago: metodo,
          referencia_pago: referencia.trim() || null,
          fecha_pago: fecha,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      await onExito();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  const fld = "w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Registrar pago al proveedor</h3>
        <p className="text-xs text-slate-500 mb-4">
          {compra.proveedor_nombre} · {compra.numero_control} · <strong>{fmt(compra.total)}</strong>
        </p>
        {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600">Método de pago</label>
            <select value={metodo} onChange={(e) => { setMetodo(e.target.value as typeof metodo); setReferencia(""); }} className={fld}>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          {requiereRef && (
            <div>
              <label className="text-xs text-slate-600">
                {metodo === "transferencia" ? "N° de comprobante de la transferencia" : "N° de ticket de la tarjeta"}
              </label>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={fld}
                placeholder={metodo === "transferencia" ? "N° comprobante" : "N° ticket"} />
            </div>
          )}
          <div>
            <label className="text-xs text-slate-600">Fecha del pago</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={fld} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50">
            {saving ? "Guardando…" : "Confirmar pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
