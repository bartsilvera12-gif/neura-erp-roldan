"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";
import MontoInput from "@/components/ui/MontoInput";
import AdjuntosEgreso, { type AdjuntoEgreso } from "@/components/caja/AdjuntosEgreso";
import { TIPOS_EGRESO, etiquetaTipoEgreso, type TipoEgreso } from "@/lib/caja/tipos-egreso";

/**
 * Ingresos y egresos.
 *
 * ── POR QUÉ ESTA PANTALLA ─────────────────────────────────────────────────
 *   Un egreso se carga en dos lugares según qué sea: el que sale del cajón en
 *   un turno va a `caja_movimientos`, y la factura de gasto va a `gastos`.
 *   Las dos están bien —una necesita caja abierta y la otra lleva el desglose
 *   de IVA— pero no había dónde verlas juntas: para saber cuánto se gastó en
 *   la semana había que sumar a mano los turnos de Cierres de caja más la
 *   pantalla de Gastos.
 *
 * ── LAS VENTAS NO ESTÁN ACÁ ───────────────────────────────────────────────
 *   Tienen su propio informe, y al lado de la facturación del mes un flete de
 *   50.000 no se ve. Los ingresos que entran son los manuales de caja: un
 *   aporte, un reintegro, la devolución de un adelanto.
 */

interface Fila {
  id: string;
  origen: "caja" | "gasto";
  fecha: string;
  tipo: string;
  clase: string | null;
  concepto: string;
  beneficiario: string | null;
  medio_pago: string | null;
  usuario: string | null;
  observacion: string | null;
  numero_factura: string | null;
  monto: number;
  signo: 1 | -1;
  caja_numero: number | null;
  adjuntos: number;
}

interface Respuesta {
  filas: Fila[];
  totales: { ingresos: number; egresos: number; neto: number; de_caja: number; de_gastos: number };
}

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Paraguay es UTC−3 todo el año. */
function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function primerDiaDelMesPy(): string {
  return `${hoyPy().slice(0, 7)}-01`;
}
function fechaHora(iso: string): { fecha: string; hora: string } {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

const TIPO_LABEL: Record<string, string> = {
  ingreso: "Ingreso", egreso: "Egreso", retiro: "Retiro", ajuste: "Ajuste",
};
const MEDIO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", otro: "Otro", cheque: "Cheque",
};

const selectCls = "rounded-lg border border-slate-200 px-3 py-2 text-sm";

function Tarjeta({ titulo, valor, pie, color }: { titulo: string; valor: string; pie?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold tabular-nums ${color ?? "text-slate-900"}`}>{valor}</p>
      {pie && <p className="text-xs text-slate-500">{pie}</p>}
    </div>
  );
}

export default function IngresosEgresosPage() {
  const [desde, setDesde] = useState(primerDiaDelMesPy);
  const [hasta, setHasta] = useState(hoyPy);
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fTipo, setFTipo] = useState("");
  const [fOrigen, setFOrigen] = useState("");
  const [fClase, setFClase] = useState("");
  const [fTexto, setFTexto] = useState("");

  const [cajaAbierta, setCajaAbierta] = useState<{ id: string; numero_caja: number } | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ desde, hasta });
      const r = await fetchWithSupabaseSession(`/api/reportes/ingresos-egresos?${sp}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Si no hay turno abierto no se puede cargar un movimiento de caja: se dice
  // antes, en vez de dejar apretar el botón y fallar al guardar.
  const cargarEstadoCaja = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/caja/estado", { cache: "no-store" });
      const j = await r.json();
      const c = j?.data?.caja;
      setCajaAbierta(c && c.estado === "abierta" ? { id: String(c.id), numero_caja: Number(c.numero_caja) } : null);
    } catch { setCajaAbierta(null); }
  }, []);
  useEffect(() => { void cargarEstadoCaja(); }, [cargarEstadoCaja]);

  const filas = data?.filas ?? [];

  const clases = useMemo(() => {
    const s = new Set<string>();
    for (const f of filas) if (f.clase) s.add(f.clase);
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const vista = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    return filas.filter((f) => {
      if (fTipo && f.tipo !== fTipo) return false;
      if (fOrigen && f.origen !== fOrigen) return false;
      if (fClase && f.clase !== fClase) return false;
      if (!q) return true;
      return [f.concepto, f.beneficiario, f.observacion, f.numero_factura, f.usuario, f.clase]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [filas, fTipo, fOrigen, fClase, fTexto]);

  // Los totales siguen a lo filtrado: si no, filtrar por "flete" mostraría
  // tres filas y un total de todo el mes.
  const tot = useMemo(() => {
    return vista.reduce(
      (t, f) => {
        if (f.signo === 1) t.ingresos += f.monto; else t.egresos += f.monto;
        return t;
      },
      { ingresos: 0, egresos: 0 }
    );
  }, [vista]);

  const hayFiltro = !!(fTipo || fOrigen || fClase || fTexto.trim());

  const columnas = ["Fecha", "Hora", "Origen", "Tipo", "Clase", "Concepto", "Beneficiario", "N° factura", "Medio", "Usuario", "Observación", "Ingreso", "Egreso"];
  const filasExport = vista.map((f) => {
    const { fecha, hora } = fechaHora(f.fecha);
    return [
      fecha, hora,
      f.origen === "caja" ? `Caja ${f.caja_numero ?? ""}`.trim() : "Gasto",
      TIPO_LABEL[f.tipo] ?? f.tipo,
      f.origen === "caja" ? etiquetaTipoEgreso(f.clase) : (f.clase ?? ""),
      f.concepto,
      f.beneficiario ?? "",
      f.numero_factura ?? "",
      MEDIO[f.medio_pago ?? ""] ?? f.medio_pago ?? "",
      f.usuario ?? "",
      f.observacion ?? "",
      f.signo === 1 ? f.monto : 0,
      f.signo === -1 ? f.monto : 0,
    ];
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/reportes" className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ← Volver a reportes
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Ingresos y egresos</h1>
          <p className="text-sm text-slate-500">
            Toda la plata que entró y salió sin ser una venta: los movimientos de caja y las facturas de gasto, juntos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            disabled={!cajaAbierta}
            title={cajaAbierta
              ? `Se registra en la Caja ${cajaAbierta.numero_caja}, que está abierta`
              : "Para cargar un movimiento de caja tiene que haber un turno abierto"}
            className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cargar movimiento de caja
          </button>
          <Link
            href="/gastos/nuevo"
            className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
          >
            Cargar gasto con factura
          </Link>
        </div>
      </div>

      {!cajaAbierta && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          No hay ningún turno de caja abierto. Un movimiento de caja necesita uno —se abre desde Ventas—; un gasto con
          factura se puede cargar igual.
        </p>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Desde</span>
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={selectCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Hasta</span>
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={selectCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Tipo</span>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={selectCls}>
            <option value="">Todos</option>
            <option value="ingreso">Ingresos</option>
            <option value="egreso">Egresos</option>
            <option value="retiro">Retiros</option>
            <option value="ajuste">Ajustes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Origen</span>
          <select value={fOrigen} onChange={(e) => setFOrigen(e.target.value)} className={selectCls}>
            <option value="">Todos</option>
            <option value="caja">Movimientos de caja</option>
            <option value="gasto">Gastos con factura</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Clase</span>
          <select value={fClase} onChange={(e) => setFClase(e.target.value)} className={`min-w-[150px] ${selectCls}`}>
            <option value="">Todas</option>
            {clases.map((c) => <option key={c} value={c}>{etiquetaTipoEgreso(c) || c}</option>)}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Buscar</span>
          <input
            type="search" value={fTexto} onChange={(e) => setFTexto(e.target.value)}
            placeholder="Concepto, beneficiario, factura, usuario…"
            className={selectCls}
          />
        </label>
        {hayFiltro && (
          <button
            type="button"
            onClick={() => { setFTipo(""); setFOrigen(""); setFClase(""); setFTexto(""); }}
            className="pb-2 text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta titulo="Ingresos" valor={gs(tot.ingresos)} color="text-emerald-700" />
        <Tarjeta titulo="Egresos" valor={gs(tot.egresos)} color="text-red-600" />
        <Tarjeta
          titulo="Neto"
          valor={gs(tot.ingresos - tot.egresos)}
          color={tot.ingresos - tot.egresos < 0 ? "text-red-600" : "text-slate-900"}
        />
        <Tarjeta
          titulo="Movimientos"
          valor={String(vista.length)}
          pie={hayFiltro ? `de ${filas.length} en el período` : undefined}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">
            Las ventas no entran acá: tienen su propio informe. Los ingresos son los manuales de caja.
          </p>
          <AccionesTabla
            titulo="Ingresos y egresos"
            archivo={`ingresos-egresos-${desde}_${hasta}`}
            subtitulo={`Del ${desde} al ${hasta}`}
            columnas={columnas}
            filas={filasExport}
            sumar={[11, 12]}
          />
        </div>

        <div className="overflow-x-auto">
          {cargando ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : vista.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              {filas.length === 0 ? "No hubo movimientos en el período." : "Ninguno coincide con los filtros."}
            </p>
          ) : (
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Origen</th>
                  <th className="px-4 py-3 font-semibold">Tipo</th>
                  <th className="px-4 py-3 font-semibold">Clase</th>
                  <th className="px-4 py-3 font-semibold">Concepto</th>
                  <th className="px-4 py-3 font-semibold">Medio</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vista.map((f) => {
                  const { fecha, hora } = fechaHora(f.fecha);
                  const entra = f.signo === 1;
                  return (
                    <tr key={`${f.origen}-${f.id}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {fecha}
                        <span className="block text-[11px] tabular-nums text-slate-400">{hora}</span>
                      </td>
                      <td className="px-4 py-3">
                        {f.origen === "caja" ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                            Caja {f.caja_numero ?? ""}
                          </span>
                        ) : (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                            Gasto
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{TIPO_LABEL[f.tipo] ?? f.tipo}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {f.origen === "caja" ? (etiquetaTipoEgreso(f.clase) || "—") : (f.clase ?? "—")}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {f.concepto || <span className="text-slate-400">—</span>}
                        {f.beneficiario && <span className="block text-[11px] text-slate-500">A: {f.beneficiario}</span>}
                        {f.numero_factura && <span className="block text-[11px] text-slate-400">Factura {f.numero_factura}</span>}
                        {f.observacion && <span className="block text-[11px] text-slate-400">{f.observacion}</span>}
                        {f.adjuntos > 0 && (
                          <span className="mt-0.5 inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            {f.adjuntos === 1 ? "1 comprobante" : `${f.adjuntos} comprobantes`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{MEDIO[f.medio_pago ?? ""] ?? f.medio_pago ?? "—"}</td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${entra ? "text-emerald-700" : "text-red-600"}`}>
                        {entra ? "+" : "−"} {gs(f.monto)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalAbierto && cajaAbierta && (
        <MovimientoCajaModal
          numeroCaja={cajaAbierta.numero_caja}
          onClose={() => setModalAbierto(false)}
          onGuardado={() => { setModalAbierto(false); void cargar(); }}
        />
      )}
    </div>
  );
}

/* ─────────────────── Cargar un movimiento de caja ───────────────────────── */
/**
 * Mismo formulario que el panel de Caja —tipo, concepto, monto, medio,
 * observación y los adjuntos del egreso— y la misma ruta. No se duplica la
 * lógica: `/api/caja/movimiento` sigue siendo el único lugar donde se valida
 * y se escribe.
 */
function MovimientoCajaModal({
  numeroCaja, onClose, onGuardado,
}: {
  numeroCaja: number;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [tipo, setTipo] = useState<"ingreso" | "egreso" | "retiro" | "ajuste">("egreso");
  const [tipoEgreso, setTipoEgreso] = useState<TipoEgreso>("proveedor");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("0");
  const [medio, setMedio] = useState("efectivo");
  const [obs, setObs] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoEgreso[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !guardando) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, guardando]);

  async function guardar() {
    const n = Number(monto);
    if (!Number.isFinite(n) || n <= 0) { setErr("Poné un monto mayor a cero."); return; }
    if (!concepto.trim()) { setErr("Escribí el concepto."); return; }
    if (tipo === "egreso" && tipoEgreso === "otros" && !obs.trim()) {
      setErr('Con la clase "Otros" hay que escribir el motivo en la observación.');
      return;
    }
    setGuardando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/caja/movimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          concepto: concepto.trim(),
          monto: n,
          medio_pago: medio,
          observacion: obs.trim() || null,
          tipo_egreso: tipo === "egreso" ? tipoEgreso : null,
          adjuntos: tipo === "egreso" && adjuntos.length > 0 ? adjuntos : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo registrar.");
      onGuardado();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={() => { if (!guardando) onClose(); }}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">Movimiento de caja</h2>
          <p className="text-sm text-slate-500">Se registra en la Caja {numeroCaja}, que está abierta.</p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-4 gap-2">
            {(["ingreso", "egreso", "retiro", "ajuste"] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => setTipo(t)}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  tipo === t ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6F72]" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {TIPO_LABEL[t]}
              </button>
            ))}
          </div>

          {tipo === "egreso" && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Clase de egreso</span>
              <select value={tipoEgreso} onChange={(e) => setTipoEgreso(e.target.value as TipoEgreso)}
                className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]">
                {TIPOS_EGRESO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Concepto</span>
            <input
              type="text" value={concepto} onChange={(e) => setConcepto(e.target.value)} maxLength={200}
              placeholder="Ej: Pago de flete"
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Monto (Gs.)</span>
              <MontoInput
                value={monto}
                onChange={(n) => setMonto(String(n))}
                decimals={false}
                className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-[#4FAEB2]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Medio de pago</span>
              <select value={medio} onChange={(e) => setMedio(e.target.value)}
                className="w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]">
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Observación</span>
            <textarea
              value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
              className="w-full resize-none rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />
          </label>

          {/* Un ingreso o un retiro no tienen factura de proveedor que adjuntar. */}
          {tipo === "egreso" && <AdjuntosEgreso value={adjuntos} onChange={setAdjuntos} disabled={guardando} />}

          {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={() => void guardar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
