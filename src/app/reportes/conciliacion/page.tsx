"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import MesSelector from "@/components/reportes/MesSelector";
import { getConciliacionReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { ConciliacionReporte, ConciliacionMovRow } from "@/lib/reportes/types";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import Link from "next/link";
import { useModoPersistido } from "@/components/ui/ToggleNutricionConsig";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const fch = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${fch} ${hh}`;
  } catch {
    return iso;
  }
}
const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
  qr: "QR", billetera: "Billetera", otro: "Otro",
};
const metodoLabel = (m: string | null) => (m ? METODO[m] ?? m : "—");
const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
};
const ESTADO_LBL: Record<string, string> = { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" };

export default function ConciliacionReportePage() {
  const [modo, setModo] = useModoPersistido("reportes-conciliacion.modo");
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<ConciliacionReporte | null>(null);
  const [movs, setMovs] = useState<ConciliacionMovRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [saldoBanco, setSaldoBanco] = useState("");

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getConciliacionReporte(mes).then((d) => { if (!cancel) { setData(d); setMovs(d?.movimientos ?? []); setCargando(false); } });
    return () => { cancel = true; };
  }, [mes]);

  async function setEstado(m: ConciliacionMovRow, estado: "aprobado" | "rechazado" | "pendiente") {
    if (busy) return;
    setBusy(m.id);
    const prev = m.estado;
    setMovs((arr) => arr.map((x) => (x.id === m.id ? { ...x, estado } : x)));
    try {
      const res = await fetchWithSupabaseSession("/api/reportes/conciliacion/movimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: m.tipo, id: m.id, estado }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setMovs((arr) => arr.map((x) => (x.id === m.id ? { ...x, estado: prev } : x)));
      }
    } catch {
      setMovs((arr) => arr.map((x) => (x.id === m.id ? { ...x, estado: prev } : x)));
    } finally {
      setBusy(null);
    }
  }

  const cuentaEstado = (e: string) => movs.filter((m) => m.estado === e).length;
  const montoEstado = (e: string) => movs.filter((m) => m.estado === e).reduce((s, m) => s + m.monto, 0);
  const saldoSistema = montoEstado("aprobado"); // conciliado = lo que el sistema confirma en el banco
  const saldoBancoNum = Number(String(saldoBanco).replace(/[^\d-]/g, "")) || 0;
  const diferencia = saldoBancoNum - saldoSistema;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Conciliación bancaria"
        description="Cobros por transferencia y tarjeta. El efectivo no se concilia."
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <MesSelector mes={mes} onChange={setMes} />
            <ExportExcelButton url={`/api/reportes/conciliacion/export?mes=${mes}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar la conciliación.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label="Total a conciliar" value={formatGs(data.totalCobrado)} accent hint="transferencia + tarjeta" />
            <StatCard compact label="Pendientes" value={String(cuentaEstado("pendiente"))} hint="por aprobar/rechazar" />
            <StatCard compact label="Aprobados" value={String(cuentaEstado("aprobado"))} />
            <StatCard compact label="Rechazados" value={String(cuentaEstado("rechazado"))} />
          </div>

          {/* Resumen de conciliación: saldo sistema vs banco */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-1">Resumen de conciliación</h2>
            <p className="text-xs text-slate-400 mb-4">Cargá el saldo de tu extracto bancario para ver la diferencia contra el sistema.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Saldo según sistema</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{formatGs(saldoSistema)}</div>
                <div className="text-xs text-slate-400">movimientos conciliados (aprobados)</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Saldo según banco</div>
                <input
                  value={saldoBanco}
                  onChange={(e) => setSaldoBanco(e.target.value)}
                  inputMode="numeric"
                  placeholder="Cargá del extracto"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-lg font-bold tabular-nums outline-none focus:ring-2 focus:ring-[#4FAEB2]/40"
                />
                <div className="text-xs text-slate-400">del extracto (no se guarda)</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Diferencia</div>
                <div className={`mt-1 text-lg font-bold tabular-nums ${diferencia === 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {saldoBanco ? formatGs(diferencia) : "—"}
                </div>
                <div className="text-xs text-slate-400">{saldoBanco ? (diferencia === 0 ? "cuadra ✓" : "banco − sistema") : "cargá el saldo banco"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Pendiente / Conciliado</div>
                <div className="mt-1 text-sm font-semibold text-amber-600 tabular-nums">{formatGs(montoEstado("pendiente"))} <span className="text-xs font-normal text-slate-400">pend.</span></div>
                <div className="text-sm font-semibold text-emerald-600 tabular-nums">{formatGs(saldoSistema)} <span className="text-xs font-normal text-slate-400">concil.</span></div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              El saldo del sistema solo considera <strong>entradas</strong> conciliadas (transferencia/tarjeta). Cuando registremos
              también las salidas por banco, el cuadre será completo.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Por método */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Por método</h2>
              {data.porMetodo.length === 0 ? (
                <p className="text-sm text-slate-400">Sin cobros con detalle.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Método</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Operaciones</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porMetodo.map((m, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{metodoLabel(m.clave)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{m.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Por entidad */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Por entidad / caja</h2>
              {data.porEntidad.length === 0 ? (
                <p className="text-sm text-slate-400">Sin cobros con detalle.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Entidad</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Operaciones</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porEntidad.map((e, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{e.clave}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{e.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(e.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Movimientos del mes con conciliación (aprobar / rechazar) */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Movimientos del mes</h2>
            {movs.length === 0 ? (
              <p className="text-sm text-slate-400">No hay cobros por transferencia o tarjeta en el período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Fecha</th>
                      <th className="py-2.5 pr-4 font-medium">N° Venta</th>
                      <th className="py-2.5 pr-4 font-medium">Método</th>
                      <th className="py-2.5 pr-4 font-medium">Banco / entidad</th>
                      <th className="py-2.5 pr-4 font-medium">Titular</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Monto</th>
                      <th className="py-2.5 pr-4 font-medium">N° Comprobante</th>
                      <th className="py-2.5 pr-4 font-medium">Estado</th>
                      <th className="py-2.5 font-medium text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movs.map((m) => (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pr-4 text-slate-600 text-xs tabular-nums">{formatFecha(m.fecha)}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-500">{m.numero ?? "—"}</td>
                        <td className="py-3 pr-4">
                          <span className="inline-block rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{metodoLabel(m.metodo_pago)}</span>
                        </td>
                        <td className="py-3 pr-4 text-slate-700">
                          {m.entidad_codigo ? <span className="font-mono text-xs text-slate-400">{m.entidad_codigo} · </span> : null}
                          {m.entidad ?? "—"}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{m.titular ?? "—"}</td>
                        <td className="py-3 pr-4 text-right tabular-nums font-semibold text-slate-800">{formatGs(m.monto)}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-500">{m.referencia ?? "—"}</td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[m.estado]}`}>{ESTADO_LBL[m.estado]}</span>
                        </td>
                        <td className="py-3 text-right">
                          {m.estado === "pendiente" ? (
                            <div className="inline-flex gap-2">
                              <button
                                disabled={busy === m.id}
                                onClick={() => setEstado(m, "aprobado")}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                Aprobar
                              </button>
                              <button
                                disabled={busy === m.id}
                                onClick={() => setEstado(m, "rechazado")}
                                className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                              >
                                Rechazar
                              </button>
                            </div>
                          ) : (
                            <button
                              disabled={busy === m.id}
                              onClick={() => setEstado(m, "pendiente")}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Revertir
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
