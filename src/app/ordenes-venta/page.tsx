"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Orden = {
  id: string;
  numero_orden: string;
  cliente_id: string;
  fecha: string;
  fecha_entrega_solicitada: string | null;
  estado: "pendiente" | "aprobada" | "procesada" | "rechazada" | "cancelada";
  observaciones: string | null;
  total: number;
  venta_id: string | null;
  items: Array<{ producto_id: string; cantidad: number; precio_unitario: number; subtotal: number }>;
};

type Cliente = { id: string; label: string };

const badgeClass: Record<Orden["estado"], string> = {
  pendiente:   "bg-amber-50 text-amber-700 border-amber-200",
  aprobada:    "bg-sky-50 text-sky-700 border-sky-200",
  procesada:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  rechazada:   "bg-red-50 text-red-700 border-red-200",
  cancelada:   "bg-slate-100 text-slate-500 border-slate-200",
};

function fmtGs(n: number): string {
  return new Intl.NumberFormat("es-PY").format(Math.round(n));
}

export default function OrdenesVentaPage() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [clientes, setClientes] = useState<Map<string, string>>(new Map());
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const qs = filtroEstado ? `?estado=${encodeURIComponent(filtroEstado)}` : "";
      const [rOrd, rCli] = await Promise.all([
        fetchWithSupabaseSession(`/api/ordenes-venta${qs}`, { cache: "no-store" }),
        fetchWithSupabaseSession(`/api/clientes`, { cache: "no-store" }),
      ]);
      const jOrd = await rOrd.json();
      const jCli = await rCli.json();
      if (rOrd.ok && jOrd.success) setOrdenes(jOrd.data.ordenes ?? []);
      if (rCli.ok && jCli.success) {
        const map = new Map<string, string>();
        for (const c of ((jCli.data.clientes ?? []) as Cliente[])) map.set(c.id, c.label ?? c.id);
        setClientes(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtroEstado]);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetchWithSupabaseSession(`/api/ordenes-venta/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || !j.success) { setError(j.error ?? `Error ${r.status}`); return; }
    await cargar();
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Órdenes de venta recibidas</h1>
          <p className="text-slate-600">Órdenes de compra que te mandan clientes (Biggie, Casa Rica, etc.). Aprobalas, rechazalas o convertí a venta.</p>
        </div>
        <Link href="/ordenes-venta/nueva"
              className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium">
          Cargar nueva orden
        </Link>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 flex-wrap">
        {[
          { v: "", label: "Todas" },
          { v: "pendiente", label: "Pendientes" },
          { v: "aprobada", label: "Aprobadas" },
          { v: "procesada", label: "Procesadas" },
          { v: "rechazada", label: "Rechazadas" },
          { v: "cancelada", label: "Canceladas" },
        ].map((op) => (
          <button key={op.v} onClick={() => setFiltroEstado(op.v)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${filtroEstado === op.v ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {op.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : ordenes.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No hay órdenes con ese filtro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">N° Orden</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Entrega</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ordenes.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{o.numero_orden}</td>
                  <td className="px-4 py-2">{clientes.get(o.cliente_id) ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{o.fecha}</td>
                  <td className="px-4 py-2 text-slate-500">{o.fecha_entrega_solicitada ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">Gs. {fmtGs(o.total)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border capitalize ${badgeClass[o.estado]}`}>
                      {o.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-3 text-xs">
                      {o.estado === "pendiente" && (
                        <>
                          <button onClick={() => patch(o.id, { estado: "aprobada" })} className="text-sky-700 hover:underline">Aprobar</button>
                          <button onClick={() => {
                            const motivo = window.prompt("Motivo del rechazo:") ?? "";
                            if (motivo.trim()) void patch(o.id, { estado: "rechazada", motivo_rechazo: motivo.trim() });
                          }} className="text-red-600 hover:underline">Rechazar</button>
                        </>
                      )}
                      {o.estado === "aprobada" && (
                        <Link href={`/ventas/nueva?desde_orden=${o.id}`}
                              className="text-emerald-700 hover:underline">
                          Convertir a venta
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
