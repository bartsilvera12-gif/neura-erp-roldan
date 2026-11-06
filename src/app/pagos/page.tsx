"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccionesTabla from "@/components/ui/AccionesTabla";
import PageHeader from "@/components/ui/PageHeader";
import BarraFiltros, { CampoFiltro, campoClase } from "@/components/ui/BarraFiltros";
import { Metrica, FilaDeMetricas } from "@/components/ui/Metrica";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { Check, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { generarYAbrirRecibo } from "@/lib/recibos/client";
import { RegistrarCobroModalCxc } from "@/components/cobros/RegistrarCobroModalCxc";
import Selector from "@/components/ui/Selector";
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


export default function PagosPage() {
  const [modo, setModo] = useModoPersistido("pagos.modo");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pendientes" | "cobrados">("pendientes");
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
      // Lo que se le debe a los PROVEEDORES ya no se pide acá: tiene su propia
      // pantalla (/pagos/proveedores). Mezclarlo con las cuentas por cobrar era
      // lo que hacía que no se entendiera: dos deudas opuestas, una al lado de
      // la otra, y las dos con un botón que decía "Registrar pago".
      const res = await fetchWithSupabaseSession(`/api/cobros/cuentas${qs}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudieron cargar las cobranzas.");
        return;
      }
      setCuentas((body.data?.cuentas ?? []) as Cuenta[]);
      setCobros((body.data?.cobros ?? []) as Cobro[]);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, [modo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);


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

  const sumPend = useMemo(
    () => pendientes.reduce((a, c) => ({ total: a.total + c.total, saldo: a.saldo + c.saldo }), { total: 0, saldo: 0 }),
    [pendientes]
  );
  const sumCob = useMemo(() => cobradosVista.reduce((a, c) => a + c.monto, 0), [cobradosVista]);

  function abrirCobro(c: Cuenta) {
    setCobrando(c);
  }

  const hayFiltro = !!desde || !!hasta || !!buscar.trim() || situacion !== "todas";

  /* Punto 11.1: la lista de lo que se debe y la de lo que se cobró, con los
     filtros puestos, en Excel. Es la que se imprime para salir a cobrar. Van
     del lado derecho de la barra: son lo que se hace CON el resultado. */
  const ACCIONES = (
    <>
      <AccionesTabla
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
      <AccionesTabla
        labelExcel="Excel cobros"
        labelImprimir="Imprimir cobros"
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
    </>
  );

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {toast && (
        <div className="inline-flex items-center gap-1.5 fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg"><Check className="h-4 w-4" /> {toast}</div>
      )}

      <PageHeader
        eyebrow="Cobranzas"
        title="Cobros a clientes"
        description="Lo que los clientes deben de las ventas a crédito, y los cobros que se les registró."
      />
      <p className="-mt-3 text-xs text-slate-500">
        ¿Buscabas lo que le debemos a un proveedor? Está en{" "}
        <Link href="/pagos/proveedores" className="font-medium text-[#3F8E91] hover:underline">
          Pagos a proveedores
        </Link>
        .
      </p>

      <BarraFiltros
        hayFiltro={hayFiltro}
        onLimpiar={() => { setDesde(""); setHasta(""); setBuscar(""); setSituacion("todas"); }}
        acciones={ACCIONES}
      >
        <CampoFiltro etiqueta="Desde">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={campoClase} />
        </CampoFiltro>
        <CampoFiltro etiqueta="Hasta">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={campoClase} />
        </CampoFiltro>
        <CampoFiltro etiqueta="Situación">
          <Selector
            value={situacion} onChange={(e) => setSituacion(e.target.value as Situacion)}
            className={`${campoClase} w-36`}
          >
            <option value="todas">Todas</option>
            <option value="vencidas">Vencidas</option>
            <option value="al_dia">Al día</option>
          </Selector>
        </CampoFiltro>
        <CampoFiltro etiqueta="Buscar">
          <input
            type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)}
            placeholder="Cliente, código o factura" className={`${campoClase} w-56`}
          />
        </CampoFiltro>
      </BarraFiltros>

      <FilaDeMetricas>
        <Metrica
          etiqueta="Cuentas con saldo"
          valor={pendientes.length}
          detalle={`de ${cuentas.length} cuentas en total`}
          cargando={loading}
        />
        <Metrica
          etiqueta="Saldo pendiente"
          tono="pendiente"
          valor={fmtGs(sumPend.saldo)}
          detalle={`sobre ${fmtGs(sumPend.total)} facturados`}
          cargando={loading}
        />
        <Metrica
          etiqueta="Cobrado en lo que se está viendo"
          tono="bien"
          valor={fmtGs(sumCob)}
          detalle={`${cobradosVista.length} ${cobradosVista.length === 1 ? "cobro" : "cobros"}`}
          cargando={loading}
        />
      </FilaDeMetricas>

      {/* Pestañas: solo 2 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("pendientes")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "pendientes" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Pendientes <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "pendientes" ? "bg-white/25" : "bg-slate-100"}`}>{pendientes.length}</span>
        </button>
        <button onClick={() => setTab("cobrados")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "cobrados" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cobrados <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "cobrados" ? "bg-white/25" : "bg-slate-100"}`}>{cobradosVista.length}</span>
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
                      <span className="text-[10px] font-medium text-slate-500">Total</span>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtGs(sumPend.total)}</p>
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-medium text-slate-500">Saldo</span>
                      <p className="text-sm font-bold tabular-nums text-amber-600">{fmtGs(sumPend.saldo)}</p>
                    </td>
                    <td colSpan={2} className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
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
                    <td className="px-4 py-3 text-right text-[10px] font-medium text-slate-500">Cobrado</td>
                    <td className="px-4 py-3 text-right"><p className="text-sm font-bold tabular-nums text-emerald-700">{fmtGs(sumCob)}</p></td>
                    <td className="px-4 py-3" />
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


    </div>
  );
}


