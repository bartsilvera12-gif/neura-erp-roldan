"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Truck, Plus, Inbox, Clock, CheckCircle2, XCircle } from "lucide-react";
import { fetchDepositos, fetchNRs, type Deposito, type NotaRemision, type NotaRemisionEstado } from "@/lib/multideposito/client";

function fmt(n: number) { return n.toLocaleString("es-PY"); }
function fmtFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return iso; }
}

export default function HistorialNRPage() {
  const [nrs, setNrs] = useState<NotaRemision[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<"" | NotaRemisionEstado>("");
  const [filtroOrigen, setFiltroOrigen] = useState("");
  const [filtroDestino, setFiltroDestino] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await fetchNRs({ estado: filtroEstado, origen: filtroOrigen, destino: filtroDestino, buscar: busqueda });
    if (!r.ok) { setError(r.error); setCargando(false); return; }
    setNrs(r.data.notas_remision);
    setCargando(false);
  }, [filtroEstado, filtroOrigen, filtroDestino, busqueda]);

  useEffect(() => { fetchDepositos().then((r) => { if (r.ok) setDepositos(r.data.depositos); }); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreUbic = (id: string) => depositos.find((d) => d.id === id)?.nombre ?? "—";

  const stats = useMemo(() => ({
    pendientes: nrs.filter((n) => n.estado === "pendiente").length,
    aprobadas: nrs.filter((n) => n.estado === "aprobada").length,
    rechazadas: nrs.filter((n) => n.estado === "rechazada").length,
  }), [nrs]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-600" /> Historial
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
              <span className="rounded-lg bg-white p-1.5 ring-1 ring-slate-200 shadow-sm">
                <Truck className="h-5 w-5 text-slate-700" />
              </span>
              Notas de Remisión
            </h1>
            <p className="mt-1 text-sm text-slate-500">Historial completo de traspasos entre depósitos.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/notas-remision/recepcion" className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 inline-flex items-center gap-1.5">
              <Inbox className="h-4 w-4" /> Recepción
            </Link>
            <Link href="/notas-remision/nueva" className="rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-emerald-500/30 hover:shadow-md inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Emitir NR
            </Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Pendientes" value={String(stats.pendientes)} icon={<Clock className="h-5 w-5" />} tone="amber" />
        <Kpi label="Aprobadas" value={String(stats.aprobadas)} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
        <Kpi label="Rechazadas" value={String(stats.rechazadas)} icon={<XCircle className="h-5 w-5" />} tone="rose" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Estado</label>
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Origen</label>
            <select value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Todos</option>
              {depositos.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Destino</label>
            <select value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Todos</option>
              {depositos.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Buscar</label>
            <input type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nro o emisor…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Número</th>
                <th className="px-5 py-3">Fecha</th>
                <th className="px-5 py-3">Origen → Destino</th>
                <th className="px-5 py-3">Emisor</th>
                <th className="px-5 py-3 text-right">Ítems</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : nrs.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">
                  Todavía no hay Notas de Remisión. <Link href="/notas-remision/nueva" className="text-emerald-700 font-medium hover:underline">Emitir la primera →</Link>
                </td></tr>
              ) : nrs.map((nr) => {
                const total = (nr.items ?? []).reduce((s, i) => s + i.cantidad, 0);
                return (
                  <tr key={nr.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-700">{nr.numero}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-600">{fmtFecha(nr.fecha)}</td>
                    <td className="px-5 py-3 text-xs text-slate-700">
                      {nombreUbic(nr.ubicacion_origen_id)} <span className="text-slate-400">→</span> <strong>{nombreUbic(nr.ubicacion_destino_id)}</strong>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-700">{nr.emisor}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-xs">{(nr.items ?? []).length}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{fmt(total)}</td>
                    <td className="px-5 py-3"><EstadoBadge estado={nr.estado} /></td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/notas-remision/${nr.id}/documento`}
                          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          title="Ver documento imprimible"
                        >
                          Imprimir
                        </Link>
                        {nr.estado === "pendiente" && (
                          <Link href="/notas-remision/recepcion" className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100">Recibir</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: NotaRemisionEstado }) {
  const map = {
    pendiente: "bg-amber-50 border-amber-200 text-amber-800",
    aprobada:  "bg-emerald-50 border-emerald-200 text-emerald-800",
    rechazada: "bg-rose-50 border-rose-200 text-rose-800",
  } as const;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[estado]}`}>{estado}</span>;
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "amber" | "emerald" | "rose" }) {
  const tones = {
    amber:   { bg: "bg-amber-100",   icon: "text-amber-700",   value: "text-amber-800" },
    emerald: { bg: "bg-emerald-100", icon: "text-emerald-600", value: "text-emerald-700" },
    rose:    { bg: "bg-rose-100",    icon: "text-rose-600",    value: "text-rose-700" },
  } as const;
  const t = tones[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className={`mt-2 text-3xl font-bold tabular-nums leading-none ${t.value}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.icon}`}>{icon}</div>
      </div>
    </div>
  );
}
