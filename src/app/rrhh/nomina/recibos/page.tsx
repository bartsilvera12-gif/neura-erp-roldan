"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Recibo = {
  id: string;
  empleado_id: string;
  empleado_nombre_snapshot: string | null;
  periodo_desde: string;
  periodo_hasta: string;
  total_devengado: number;
  total_deducciones: number;
  liquido: number;
  coste_empresa: number;
  estado: string;
};

type Empleado = { id: string; nombre: string };

function fmt(n: number) {
  return `Gs ${(Number(n) || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RecibosPage() {
  const router = useRouter();
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nuevoEmpleadoId, setNuevoEmpleadoId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; nombre: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cargar = () => {
    setLoading(true);
    fetchWithSupabaseSession(`/api/rrhh/nomina/recibos?mes=${mes}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { recibos: Recibo[] }; error?: string };
        if (r.ok && j.success && j.data) { setRecibos(j.data.recibos); setErr(null); }
        else setErr(j.error ?? "No se pudo cargar");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [mes]);

  useEffect(() => {
    fetchWithSupabaseSession("/api/rrhh/empleados", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { empleados: Empleado[] } };
        if (r.ok && j.success && j.data) setEmpleados(j.data.empleados);
      })
      .catch(() => {});
  }, []);

  const crear = async () => {
    if (!nuevoEmpleadoId) return;
    setCreating(true);
    const [y, m] = mes.split("-").map((v) => parseInt(v, 10));
    const lastDay = new Date(Date.UTC(y, m, 0)).getDate();
    const body = {
      empleado_id: nuevoEmpleadoId,
      periodo_desde: `${mes}-01`,
      periodo_hasta: `${mes}-${String(lastDay).padStart(2, "0")}`,
      total_dias: lastDay,
      dias_cotizados: lastDay,
      devengos: [],
      deducciones: [],
    };
    const r = await fetchWithSupabaseSession("/api/rrhh/nomina/recibos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { recibo: { id: string } }; error?: string };
    setCreating(false);
    if (r.ok && j.success && j.data) {
      router.push(`/rrhh/nomina/recibos/${j.data.recibo.id}`);
    } else {
      alert(j.error ?? "No se pudo crear");
    }
  };

  const confirmarEliminar = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${confirmDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(null);
    if (r.ok) cargar();
    else alert("No se pudo eliminar");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · RRHH · Nómina"
        title="Recibos de nómina"
        description="Recibos individuales por empleado y mes. Edita los devengos y deducciones y descargá el PDF."
        backHref="/rrhh/nomina"
        backLabel="Nómina"
        actions={
          <div className="flex items-center gap-2">
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            <button onClick={() => setShowNew(true)}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F9EA2]">
              + Nuevo recibo
            </button>
          </div>
        }
      />

      {err && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      {showNew && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Nuevo recibo para {mes}</h3>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Empleado</label>
              <select value={nuevoEmpleadoId} onChange={(e) => setNuevoEmpleadoId(e.target.value)}
                className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm min-w-[260px]">
                <option value="">—</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            <button onClick={crear} disabled={creating || !nuevoEmpleadoId}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {creating ? "Creando…" : "Crear y editar"}
            </button>
            <button onClick={() => setShowNew(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Empleado</th>
              <th className="px-4 py-3 font-semibold">Periodo</th>
              <th className="px-4 py-3 font-semibold text-right">Devengado</th>
              <th className="px-4 py-3 font-semibold text-right">Deducciones</th>
              <th className="px-4 py-3 font-semibold text-right">Líquido</th>
              <th className="px-4 py-3 font-semibold text-right">Coste empresa</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400">Cargando…</td></tr>
            ) : recibos.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400">Sin recibos en este mes</td></tr>
            ) : recibos.map((r) => (
              <tr key={r.id} className="hover:bg-[#4FAEB2]/[0.04]">
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  <Link href={`/rrhh/nomina/recibos/${r.id}`} className="hover:underline">
                    {r.empleado_nombre_snapshot ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-gray-600">{r.periodo_desde} → {r.periodo_hasta}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.total_devengado)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.total_deducciones)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold">{fmt(r.liquido)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmt(r.coste_empresa)}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{r.estado}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <a href={`/api/rrhh/nomina/recibos/${r.id}/pdf`} target="_blank" rel="noreferrer"
                     className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50">PDF</a>
                  <button onClick={() => setConfirmDelete({ id: r.id, nombre: r.empleado_nombre_snapshot ?? "" })}
                    className="ml-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100">
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Eliminar recibo"
        message={confirmDelete ? `¿Eliminar el recibo de ${confirmDelete.nombre || "este empleado"}? Se borran también sus devengos y deducciones. Esta acción no se puede deshacer.` : undefined}
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleting}
        onConfirm={confirmarEliminar}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
