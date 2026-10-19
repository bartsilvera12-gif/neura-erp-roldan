"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Linea = {
  id: string;
  nombre: string;
  cargo: string | null;
  salario_base: number;
  horas_obras: number;
  costo_horas_obras: number;
  horas_fichaje: number;
  dias_vacaciones: number;
  total_devengado: number;
};

type Data = {
  mes: string;
  empleados: Linea[];
  totales: {
    salario_base: number;
    costo_horas_obras: number;
    total_devengado: number;
    horas_obras: number;
    horas_fichaje: number;
    dias_vacaciones: number;
  };
};

function fmtGs(n: number): string {
  return `Gs ${n.toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function NominaPage() {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWithSupabaseSession(`/api/rrhh/nomina?mes=${mes}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: Data; error?: string };
        if (cancelled) return;
        if (r.ok && j.success && j.data) { setData(j.data); setErr(null); }
        else setErr(j.error ?? "No se pudo cargar");
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mes]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · RRHH"
        title="Nómina mensual"
        description="Resumen calculado desde salarios base, horas trabajadas en obras y vacaciones aprobadas."
        backHref="/rrhh"
        backLabel="RRHH"
        actions={
          <div className="flex items-center gap-2">
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            <Link href="/rrhh/nomina/recibos"
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F9EA2]">
              Recibos PDF
            </Link>
          </div>
        }
      />

      {err && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Salario base" value={fmtGs(data.totales.salario_base)} />
          <Kpi label="Costo horas obra" value={fmtGs(data.totales.costo_horas_obras)} hint={`${data.totales.horas_obras.toFixed(1)} h`} />
          <Kpi label="Horas fichaje" value={data.totales.horas_fichaje.toFixed(1)} hint="control horario" />
          <Kpi label="Total devengado" value={fmtGs(data.totales.total_devengado)} highlight />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Empleado</th>
              <th className="px-4 py-3 font-semibold hidden md:table-cell">Cargo</th>
              <th className="px-4 py-3 font-semibold text-right">Salario base</th>
              <th className="px-4 py-3 font-semibold text-right hidden md:table-cell">Horas obra</th>
              <th className="px-4 py-3 font-semibold text-right">Costo obra</th>
              <th className="px-4 py-3 font-semibold text-right hidden lg:table-cell">Horas fichaje</th>
              <th className="px-4 py-3 font-semibold text-right hidden lg:table-cell">Días vacaciones</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400">Calculando…</td></tr>
            ) : !data || data.empleados.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400">Sin empleados activos</td></tr>
            ) : (
              data.empleados.map((e) => (
                <tr key={e.id} className="hover:bg-[#4FAEB2]/[0.04]">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{e.nombre}</td>
                  <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{e.cargo ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtGs(e.salario_base)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 hidden md:table-cell">{e.horas_obras.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtGs(e.costo_horas_obras)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 hidden lg:table-cell">{e.horas_fichaje.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 hidden lg:table-cell">{e.dias_vacaciones}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmtGs(e.total_devengado)}</td>
                </tr>
              ))
            )}
            {data && data.empleados.length > 0 && (
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-4 py-3 text-slate-800">Totales</td>
                <td className="px-4 py-3 hidden md:table-cell"></td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-800">{fmtGs(data.totales.salario_base)}</td>
                <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell text-slate-800">{data.totales.horas_obras.toFixed(1)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-800">{fmtGs(data.totales.costo_horas_obras)}</td>
                <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell text-slate-800">{data.totales.horas_fichaje.toFixed(1)}</td>
                <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell text-slate-800">{data.totales.dias_vacaciones}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">{fmtGs(data.totales.total_devengado)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        El total devengado suma <strong>salario base + costo de horas imputadas a obras</strong> en el mes.
        Si querés que las horas extras o nocturnas se paguen distinto, ajustá <code>costo_hora</code> por empleado
        y reasignalas en las obras correspondientes.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${highlight ? "border-[#4FAEB2]/40 bg-[#E5F4F4]" : "border-slate-200 bg-white"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-800">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
