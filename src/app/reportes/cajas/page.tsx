"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import type { CajasReporte } from "@/lib/caja/types";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Fecha corta en hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  } catch {
    return "—";
  }
}

function mesActual(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function ReporteCajasPage() {
  const [mes, setMes] = useState(mesActual);
  const [data, setData] = useState<(CajasReporte & { mes?: string }) | null>(null);
  const [cargando, setCargando] = useState(true);
  const { isAdmin } = useIsAdmin();
  const [reabriendo, setReabriendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/reportes/cajas?mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el reporte.");
      setData(j.data as CajasReporte);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [mes]);

  useEffect(() => { void cargar(); }, [cargar]);

  const t = data?.totales;

  /**
   * Reabrir un turno cerrado (punto 5.1).
   *
   * Pide el motivo porque es lo que se va a leer cuando alguien pregunte por
   * qué el arqueo de ese día cambió después de haberse cerrado.
   */
  async function reabrir(cajaId: string, numero: number) {
    const motivo = window.prompt(
      `¿Por qué se reabre la Caja ${numero}?\n\n` +
      "Queda registrado en la observación del cierre junto con tu nombre y la hora.\n" +
      "Los números del cierre original se conservan para poder compararlos."
    );
    if (motivo == null) return;
    if (!motivo.trim()) { alert("Hace falta el motivo."); return; }

    setReabriendo(cajaId);
    try {
      const r = await fetchWithSupabaseSession(`/api/cajas/${cajaId}/reabrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo reabrir.");
      await cargar();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setReabriendo(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/reportes" className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ← Volver a reportes
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Cierres de caja</h1>
          <p className="text-sm text-slate-500">
            Un turno por fila: lo que se vendió, lo que se contó al cerrar y la diferencia.
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Mes</span>
          <input
            type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {t && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Turnos" valor={String(t.cantidad_cajas)}
            sub={`${t.cajas_cerradas} cerrados · ${t.cajas_abiertas} abiertos`} />
          <Tarjeta label="Vendido" valor={gs(t.total_vendido)}
            sub={`Efectivo ${gs(t.total_efectivo)}`} />
          <Tarjeta label="Otros medios" valor={gs(t.total_tarjeta + t.total_transferencia + t.total_cheque)}
            sub="Tarjeta, transferencia y cheque" />
          {/* El signo importa: sobrante y faltante no son lo mismo aunque el
              neto dé parecido, así que van separados abajo. */}
          <Tarjeta
            label="Diferencia neta"
            valor={gs(t.total_diferencia)}
            sub={`Faltantes ${gs(t.faltantes)} · Sobrantes ${gs(t.sobrantes)}`}
            tono={t.faltantes > 0 ? "alerta" : "ok"}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Caja</th>
                <th className="px-4 py-3">Apertura</th>
                <th className="px-4 py-3">Cierre</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3 text-right">Ventas</th>
                <th className="px-4 py-3 text-right">Efectivo esperado</th>
                <th className="px-4 py-3 text-right">Contado</th>
                <th className="px-4 py-3 text-right">Diferencia</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : !data || data.cajas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    No hubo turnos de caja en este mes.
                  </td>
                </tr>
              ) : (
                data.cajas.map((c) => {
                  const dif = Number(c.diferencia ?? 0);
                  const abierta = c.estado !== "cerrada";
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        Caja {c.numero_caja}
                        {abierta && (
                          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            abierta
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{fechaCorta(c.fecha_apertura)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{fechaCorta(c.fecha_cierre)}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {c.cerrada_por_nombre ?? c.abierta_por_nombre ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {gs(c.total_vendido)}
                        <span className="ml-1 text-[11px] text-slate-400">({c.cantidad_ventas})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{gs(c.efectivo_esperado)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {abierta ? <span className="text-slate-300">—</span> : gs(Number(c.monto_cierre_contado ?? 0))}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                        abierta ? "text-slate-300" : dif < 0 ? "text-red-600" : dif > 0 ? "text-amber-600" : "text-emerald-700"
                      }`}>
                        {abierta ? "—" : dif === 0 ? "Cuadra" : gs(dif)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {/* Punto 5.1: consultar el cierre. Antes esto abría el
                            PDF directamente, así que para revisar una venta del
                            turno había que imprimir una hoja. Ahora lleva al
                            detalle en pantalla, donde cada venta se abre; la
                            hoja para firmar está adentro. */}
                        <Link
                          href={`/reportes/cajas/${c.id}`}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
                          title="Ventas del turno, anulaciones con su motivo, ingresos y egresos, y el arqueo"
                        >
                          Ver cierre
                        </Link>
                        {!abierta && isAdmin && (
                          <button
                            type="button"
                            onClick={() => void reabrir(c.id, c.numero_caja)}
                            disabled={reabriendo === c.id}
                            className="ml-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            title="Reabrir este turno para corregirlo"
                          >
                            {reabriendo === c.id ? "…" : "Reabrir"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        <strong>Efectivo esperado</strong> = apertura + ventas en efectivo + ingresos − egresos − retiros ± ajustes.
        Tarjeta, transferencia y cheque no entran: no cambian el efectivo del cajón.
        <strong> Diferencia</strong> = contado − esperado: negativa es faltante, positiva es sobrante.
      </p>
    </div>
  );
}

function Tarjeta({
  label, valor, sub, tono = "neutro",
}: {
  label: string; valor: string; sub?: string; tono?: "neutro" | "ok" | "alerta";
}) {
  const color =
    tono === "alerta" ? "text-red-600" : tono === "ok" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
