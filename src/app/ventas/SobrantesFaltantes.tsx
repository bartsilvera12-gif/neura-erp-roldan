"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChevronDown, ChevronRight, Scale } from "lucide-react";

/**
 * "Sobrantes y faltantes": una cuenta propia en Caja, como si fuera otra caja.
 *
 * Junta lo que sobró o faltó en cada venta en efectivo (vuelto que no se dio,
 * o lo que se aceptó de menos) y muestra el saldo del mes. Cada uno ya está
 * sumado o restado en el efectivo esperado de su caja.
 */

type Mov = { id: string; concepto: string; monto: number; observacion: string | null; created_at: string };

const gs = (n: number) => "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");
const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const fechaHora = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export default function SobrantesFaltantes() {
  const [desde, setDesde] = useState(`${hoyPy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoyPy());
  const [datos, setDatos] = useState<{ movimientos: Mov[]; sobrantes: number; faltantes: number; saldo: number } | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession(`/api/caja/sobrantes?desde=${desde}&hasta=${hasta}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.success) setDatos(j.data);
    } catch { /* se reintenta al cambiar las fechas */ }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  const saldo = datos?.saldo ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full flex-wrap items-center gap-4 px-4 py-3 text-left">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
          <Scale className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Sobrantes y faltantes</span>
          <span className="block text-xs text-slate-500">De las ventas en efectivo · {datos?.movimientos.length ?? 0} en el período</span>
        </span>
        <span className="flex items-center gap-6 text-sm tabular-nums">
          <span><span className="block text-[11px] uppercase text-slate-400">Sobró</span><span className="font-semibold text-emerald-700">{gs(datos?.sobrantes ?? 0)}</span></span>
          <span><span className="block text-[11px] uppercase text-slate-400">Faltó</span><span className="font-semibold text-rose-600">{gs(datos?.faltantes ?? 0)}</span></span>
          <span><span className="block text-[11px] uppercase text-slate-400">Saldo</span><span className={`font-bold ${saldo >= 0 ? "text-slate-900" : "text-rose-700"}`}>{saldo < 0 ? "− " : ""}{gs(Math.abs(saldo))}</span></span>
        </span>
        {abierto ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1 text-slate-500">Desde
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-slate-500">Hasta
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
          </div>
          {(datos?.movimientos.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">
              No hubo sobrantes ni faltantes en estas fechas. Se registran al cobrar en efectivo, tildando la opción debajo del vuelto.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {datos!.movimientos.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-slate-400">{fechaHora(m.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={m.observacion ?? undefined}>{m.concepto}</span>
                  <span className={`shrink-0 font-semibold tabular-nums ${m.monto >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {m.monto >= 0 ? "+ " : "− "}{gs(Math.abs(m.monto))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
