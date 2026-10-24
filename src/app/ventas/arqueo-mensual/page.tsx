"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { CajasReporte, CajaReporteRow } from "@/lib/caja/types";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Con signo explícito: un arqueo donde no se distingue +30.000 de −30.000 no sirve. */
const gsConSigno = (n: number) => {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return "Gs. 0";
  return `${v > 0 ? "+" : "−"} Gs. ${Math.abs(v).toLocaleString("es-PY")}`;
};

/** Día calendario en hora de Paraguay (UTC−3), sin depender de la tzdata del server. */
function diaPy(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function mesActual(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Dia = {
  fecha: string;
  turnos: CajaReporteRow[];
  diferencia: number;
};

export default function ArqueoMensualPage() {
  const [mes, setMes] = useState(mesActual);
  const [data, setData] = useState<CajasReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/reportes/cajas?mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el arqueo.");
      setData(j.data as CajasReporte);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [mes]);

  useEffect(() => { void cargar(); }, [cargar]);

  /**
   * Un renglón por día, agrupando los turnos cerrados de esa jornada.
   *
   * Solo entran los turnos CERRADOS: un turno abierto todavía no tiene
   * diferencia, y contarlo como cero ensuciaría el neto del mes.
   */
  const dias: Dia[] = useMemo(() => {
    const porDia = new Map<string, Dia>();
    for (const c of data?.cajas ?? []) {
      if (c.estado !== "cerrada" || c.diferencia == null) continue;
      const fecha = diaPy(c.fecha_cierre) || diaPy(c.fecha_apertura);
      if (!fecha) continue;
      const prev = porDia.get(fecha) ?? { fecha, turnos: [], diferencia: 0 };
      prev.turnos.push(c);
      prev.diferencia += Number(c.diferencia) || 0;
      porDia.set(fecha, prev);
    }
    return [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [data]);

  /** Faltantes y sobrantes se acumulan por separado; el neto es la resta. */
  const resumen = useMemo(() => {
    let faltantes = 0;
    let sobrantes = 0;
    for (const d of dias) {
      if (d.diferencia < 0) faltantes += -d.diferencia;
      else if (d.diferencia > 0) sobrantes += d.diferencia;
    }
    return { faltantes, sobrantes, neto: sobrantes - faltantes, diasConDiferencia: dias.filter((d) => d.diferencia !== 0).length };
  }, [dias]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/ventas" className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ← Volver a caja
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Arqueo mensual</h1>
          <p className="text-sm text-slate-500">
            Las diferencias de cada día, compensadas en el mes. No modifica ningún cierre.
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

      {/* Los tres números que pide el arqueo: faltantes, sobrantes y el neto.
          Van separados a propósito: el neto solo esconde los otros dos. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Caja label="Faltantes del mes" valor={gs(resumen.faltantes)} tono="rojo"
          sub="Días en que el conteo dio menos que lo esperado" />
        <Caja label="Sobrantes del mes" valor={gs(resumen.sobrantes)} tono="ambar"
          sub="Días en que el conteo dio de más" />
        <Caja
          label="Saldo neto"
          valor={gsConSigno(resumen.neto)}
          tono={resumen.neto < 0 ? "rojo" : resumen.neto > 0 ? "ambar" : "verde"}
          sub={
            resumen.neto === 0 ? "El mes cierra sin diferencia"
            : resumen.neto < 0 ? "Faltante neto del mes"
            : "Sobrante neto del mes"
          }
          destacado
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
          Detalle por día
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Día</th>
                <th className="px-5 py-3">Turnos</th>
                <th className="px-5 py-3 text-right">Esperado</th>
                <th className="px-5 py-3 text-right">Contado</th>
                <th className="px-5 py-3 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : dias.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    No hay turnos cerrados en este mes.
                  </td>
                </tr>
              ) : (
                dias.map((d) => {
                  const esperado = d.turnos.reduce((s, c) => s + (Number(c.monto_esperado_efectivo ?? c.efectivo_esperado) || 0), 0);
                  const contado = d.turnos.reduce((s, c) => s + (Number(c.monto_cierre_contado) || 0), 0);
                  return (
                    <tr key={d.fecha} className="hover:bg-slate-50/60">
                      <td className="px-5 py-2.5 tabular-nums font-medium text-slate-800">
                        {d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}
                      </td>
                      <td className="px-5 py-2.5 text-slate-500">
                        {d.turnos.map((c) => `Caja ${c.numero_caja}`).join(", ")}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{gs(esperado)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{gs(contado)}</td>
                      <td className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                        d.diferencia < 0 ? "text-red-600" : d.diferencia > 0 ? "text-amber-600" : "text-slate-400"
                      }`}>
                        {d.diferencia === 0 ? "Cuadra" : gsConSigno(d.diferencia)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {dias.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td colSpan={4} className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-600">
                    Neto del mes ({resumen.diasConDiferencia} {resumen.diasConDiferencia === 1 ? "día" : "días"} con diferencia)
                  </td>
                  <td className={`px-5 py-3 text-right text-base font-bold tabular-nums ${
                    resumen.neto < 0 ? "text-red-600" : resumen.neto > 0 ? "text-amber-600" : "text-emerald-700"
                  }`}>
                    {gsConSigno(resumen.neto)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        Cada día conserva su diferencia con signo: <strong>negativa</strong> es faltante,
        <strong> positiva</strong> es sobrante. El neto del mes las compensa entre sí —
        por ejemplo, faltantes por Gs. 70.000 y sobrantes por Gs. 30.000 dan un faltante
        neto de Gs. 40.000. Esta pantalla <strong>solo lee</strong>: no modifica ningún
        cierre ya hecho.
      </p>
    </div>
  );
}

function Caja({
  label, valor, sub, tono, destacado = false,
}: {
  label: string; valor: string; sub?: string;
  tono: "rojo" | "ambar" | "verde"; destacado?: boolean;
}) {
  const color = tono === "rojo" ? "text-red-600" : tono === "ambar" ? "text-amber-600" : "text-emerald-700";
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${destacado ? "border-slate-300 ring-1 ring-slate-200" : "border-slate-200"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-slate-400">{sub}</p>}
    </div>
  );
}
