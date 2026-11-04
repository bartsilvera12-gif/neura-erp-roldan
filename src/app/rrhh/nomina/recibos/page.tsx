"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Iniciales } from "@/components/rrhh/EmpleadoBadges";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { nombreMes } from "@/lib/rrhh/nomina-py";
import { ChevronLeft, ChevronRight, FileText, Landmark, Receipt, Sparkles, Trash2, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

type Recibo = {
  id: string;
  empleado_id: string;
  empleado_nombre_snapshot: string | null;
  empleado_cargo_snapshot: string | null;
  periodo_desde: string;
  dias_trabajados: number | null;
  total_devengado: number;
  total_deducciones: number;
  liquido: number;
  aporte_patronal: number | null;
  ips_trabajador: number;
  coste_empresa: number;
  estado: string;
};

type Empleado = { id: string; nombre: string; cargo: string | null; salario_base: number; estado: string; tipo_periodo?: string | null };

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function mesActualPy() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
function moverMes(mes: string, delta: number) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default function RecibosPage() {
  const router = useRouter();
  const [mes, setMes] = useState(mesActualPy());
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; nombre: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos?mes=${mes}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { recibos: Recibo[] }; error?: string };
      if (r.ok && j.success && j.data) setRecibos(j.data.recibos);
      else setMsg({ ok: false, text: j.error ?? "No se pudieron cargar los recibos" });
    } finally {
      setLoading(false);
    }
  }, [mes]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    fetchWithSupabaseSession("/api/rrhh/empleados", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { empleados?: Empleado[] } }) => {
        if (j?.success) setEmpleados((j.data?.empleados ?? []).filter((e) => e.estado !== "baja"));
      })
      .catch(() => {});
  }, []);

  /** Una fila por empleado activo; más los recibos de gente que ya no está. */
  const filas = useMemo(() => {
    const porEmpleado = new Map(recibos.map((r) => [r.empleado_id, r]));
    const activos = empleados.map((e) => ({ empleado: e, recibo: porEmpleado.get(e.id) ?? null }));
    const idsActivos = new Set(empleados.map((e) => e.id));
    const otros = recibos
      .filter((r) => !idsActivos.has(r.empleado_id))
      .map((r) => ({
        empleado: { id: r.empleado_id, nombre: r.empleado_nombre_snapshot ?? "—", cargo: r.empleado_cargo_snapshot, salario_base: 0, estado: "baja" } as Empleado,
        recibo: r as Recibo | null,
      }));
    return [...activos, ...otros];
  }, [empleados, recibos]);

  const sinRecibo = filas.filter((f) => !f.recibo && f.empleado.estado !== "baja");
  const totNeto = recibos.reduce((s, r) => s + (Number(r.liquido) || 0), 0);
  const totIpsPatronal = recibos.reduce((s, r) => s + (Number(r.aporte_patronal) || 0), 0);
  const totIpsTrab = recibos.reduce((s, r) => s + (Number(r.ips_trabajador) || 0), 0);
  const totCosto = recibos.reduce((s, r) => s + (Number(r.coste_empresa) || 0), 0);

  async function generar(ids: string[], clave: string) {
    if (ids.length === 0) return;
    setGenerando(clave);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/nomina/recibos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, empleado_ids: ids }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean; error?: string;
        data?: { creados: Array<{ id: string }>; salteados: string[]; errores: string[] };
      };
      if (!r.ok || !j.success || !j.data) { setMsg({ ok: false, text: j.error ?? "No se pudo generar" }); return; }
      // Uno solo: directo a revisarlo. Varios: se quedan en la lista.
      if (ids.length === 1 && j.data.creados.length === 1) {
        router.push(`/rrhh/nomina/recibos/${j.data.creados[0].id}`);
        return;
      }
      const partes = [`${j.data.creados.length} recibo${j.data.creados.length === 1 ? "" : "s"} generado${j.data.creados.length === 1 ? "" : "s"}`];
      if (j.data.salteados.length) partes.push(`${j.data.salteados.length} ya tenía${j.data.salteados.length === 1 ? "" : "n"}`);
      if (j.data.errores.length) partes.push(`errores: ${j.data.errores.join("; ")}`);
      setMsg({ ok: j.data.errores.length === 0, text: partes.join(" · ") + "." });
      await cargar();
    } finally {
      setGenerando(null);
    }
  }

  const confirmarEliminar = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const r = await fetchWithSupabaseSession(`/api/rrhh/nomina/recibos/${confirmDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(null);
    if (r.ok) void cargar();
    else setMsg({ ok: false, text: "No se pudo eliminar" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RRHH · Nómina"
        title="Recibos de salario"
        description="Generá los recibos del mes con un clic: salario e IPS ya calculados. Solo agregás lo que cambie."
        backHref="/rrhh/nomina"
        backLabel="Nómina"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white">
              <button type="button" onClick={() => setMes(moverMes(mes, -1))} className="px-2 py-2 text-slate-500 hover:text-slate-800" aria-label="Mes anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[132px] text-center text-sm font-medium capitalize text-slate-800">{nombreMes(mes)}</span>
              <button type="button" onClick={() => setMes(moverMes(mes, 1))} className="px-2 py-2 text-slate-500 hover:text-slate-800" aria-label="Mes siguiente">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => generar(sinRecibo.map((f) => f.empleado.id), "todos")}
              disabled={sinRecibo.length === 0 || generando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {generando === "todos" ? "Generando…" : sinRecibo.length === 0 ? "Todos generados" : `Generar ${sinRecibo.length} recibo${sinRecibo.length === 1 ? "" : "s"}`}
            </button>
          </div>
        }
      />

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard compact label="Recibos del mes" value={`${recibos.length} de ${empleados.length}`} icon={<Receipt className="h-4 w-4" />}
          hint={sinRecibo.length ? `faltan ${sinRecibo.length}` : "todos generados"} />
        <StatCard compact label="Neto a pagar" value={gs(totNeto)} icon={<Wallet className="h-4 w-4" />} accent />
        <StatCard compact label="IPS a depositar" value={gs(totIpsTrab + totIpsPatronal)} icon={<Landmark className="h-4 w-4" />}
          hint={`trabajador ${gs(totIpsTrab)} · patronal ${gs(totIpsPatronal)}`} />
        <StatCard compact label="Costo total" value={gs(totCosto)} icon={<FileText className="h-4 w-4" />} hint="salarios + aporte patronal" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Empleado</th>
              <th className="px-4 py-3 text-right">Salario base</th>
              <th className="px-4 py-3 text-right">Ingresos</th>
              <th className="px-4 py-3 text-right">Descuentos</th>
              <th className="px-4 py-3 text-right">Neto a cobrar</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">
                No hay empleados activos. <Link href="/rrhh/empleados" className="text-[#3F8E91] underline">Cargá empleados</Link>.
              </td></tr>
            ) : filas.map(({ empleado: e, recibo: r }) => (
              <tr key={e.id} className="hover:bg-[#4FAEB2]/[0.04]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Iniciales nombre={e.nombre} />
                    <div className="min-w-0">
                      {r ? (
                        <Link href={`/rrhh/nomina/recibos/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-[#3F8E91]">{e.nombre}</Link>
                      ) : (
                        <span className="block truncate font-medium text-slate-800">{e.nombre}</span>
                      )}
                      <span className="block text-xs text-slate-400">
                        {e.cargo ?? "—"}{r && r.dias_trabajados != null && r.dias_trabajados < 30 ? ` · ${r.dias_trabajados} días` : ""}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {e.salario_base > 0 ? gs(e.salario_base) : e.estado === "baja" ? "—" : (
                    <Link href={`/rrhh/empleados/${e.id}`} className="text-xs font-medium text-amber-700 hover:underline">Sin salario cargado</Link>
                  )}
                </td>
                {r ? (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{gs(r.total_devengado)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">− {gs(r.total_deducciones)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{gs(r.liquido)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link href={`/rrhh/nomina/recibos/${r.id}`}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Revisar</Link>
                      <a href={`/api/rrhh/nomina/recibos/${r.id}/pdf`} target="_blank" rel="noreferrer"
                        className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">PDF</a>
                      <button onClick={() => setConfirmDelete({ id: r.id, nombre: e.nombre })} title="Eliminar recibo"
                        className="ml-1.5 inline-flex items-center rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td colSpan={3} className="px-4 py-3 text-right text-xs text-slate-400">Sin recibo este mes</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => generar([e.id], e.id)} disabled={generando !== null}
                        className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10 disabled:opacity-50">
                        {generando === e.id ? "Generando…" : "Generar"}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
          Cada recibo nace con el salario del mes completo (30 días) y el IPS: 9% del trabajador y 16,5% patronal sobre lo
          imponible. Si alguien trabajó menos días o tiene horas extra, anticipos o bonificación familiar, se ajusta en Revisar.
        </p>
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Eliminar recibo"
        message={confirmDelete ? `¿Eliminar el recibo de ${confirmDelete.nombre} de ${nombreMes(mes)}? Después se puede volver a generar.` : undefined}
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleting}
        onConfirm={confirmarEliminar}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
