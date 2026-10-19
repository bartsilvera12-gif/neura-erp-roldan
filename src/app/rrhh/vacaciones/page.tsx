"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Empleado = { id: string; nombre: string; cargo: string | null };
type Estado = "pendiente" | "aprobada" | "rechazada" | "cancelada";
type Tipo = "vacaciones" | "permiso_retribuido" | "baja_medica" | "ausencia_sin_sueldo" | "otro";

type Solicitud = {
  id: string;
  empleado_id: string;
  empleado_nombre: string | null;
  empleado_cargo: string | null;
  fecha_desde: string;
  fecha_hasta: string;
  dias: number;
  tipo_ausencia: Tipo | null;
  estado: Estado;
  observacion: string | null;
};

type Saldo = {
  empleado_id: string;
  empleado_nombre: string;
  cargo: string | null;
  dias_anuales: number;
  dias_generados: number;
  dias_usados: number;
  dias_pendientes_aprobacion: number;
  dias_disponibles: number;
  proxima_ausencia_desde: string | null;
  proxima_ausencia_hasta: string | null;
};

const TIPO_LABEL: Record<Tipo, string> = {
  vacaciones: "Vacaciones",
  permiso_retribuido: "Permiso retribuido",
  baja_medica: "Baja médica",
  ausencia_sin_sueldo: "Ausencia sin sueldo",
  otro: "Otro",
};

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PY");
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#4FAEB2]/50 focus:ring-2 focus:ring-[#4FAEB2]/30";
const lblCls = "block text-xs font-medium text-slate-600 mb-1";

export default function VacacionesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando…</div>}>
      <VacacionesInner />
    </Suspense>
  );
}

function VacacionesInner() {
  const searchParams = useSearchParams();
  const empleadoFiltro = searchParams?.get("empleadoId") ?? "";

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"lista" | "saldos">("lista");
  const [previewDias, setPreviewDias] = useState<{ dias: number; tipo: string; naturales: number; laborables: number } | null>(null);
  const [modoComputo, setModoComputo] = useState<"auto" | "laborables" | "naturales">("auto");
  // Buscador que aplica a Listado y Saldos.
  const [busqueda, setBusqueda] = useState("");

  const [form, setForm] = useState({
    empleado_id: empleadoFiltro,
    tipo_ausencia: "vacaciones" as Tipo,
    fecha_desde: todayIso(),
    fecha_hasta: todayIso(),
    observacion: "",
    origen: "empleado" as "empleado" | "empresa",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const empQs = empleadoFiltro ? `?empleadoId=${encodeURIComponent(empleadoFiltro)}` : "";
      const [rE, rS, rB] = await Promise.all([
        fetchWithSupabaseSession("/api/rrhh/empleados", { cache: "no-store" }),
        fetchWithSupabaseSession(`/api/rrhh/vacaciones${empQs}`, { cache: "no-store" }),
        fetchWithSupabaseSession("/api/rrhh/vacaciones/saldos", { cache: "no-store" }),
      ]);
      const jE = (await rE.json().catch(() => ({}))) as { success?: boolean; data?: { empleados?: Empleado[] } };
      const jS = (await rS.json().catch(() => ({}))) as { success?: boolean; data?: { solicitudes?: Solicitud[] }; error?: string };
      const jB = (await rB.json().catch(() => ({}))) as { success?: boolean; data?: { saldos?: Saldo[] } };
      if (rE.ok && jE.success) setEmpleados(jE.data?.empleados ?? []);
      if (rS.ok && jS.success) { setSolicitudes(jS.data?.solicitudes ?? []); setErr(null); }
      else setErr(jS.error ?? "No se pudieron cargar las solicitudes");
      if (rB.ok && jB.success) {
        setSaldos(jB.data?.saldos ?? []);
      }
    } finally { setLoading(false); }
  }, [empleadoFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  // Preview de días en vivo.
  useEffect(() => {
    if (!form.fecha_desde || !form.fecha_hasta) { setPreviewDias(null); return; }
    const ctrl = new AbortController();
    const forzarQs = modoComputo !== "auto" ? `&forzar=${modoComputo}` : "";
    fetchWithSupabaseSession(
      `/api/rrhh/vacaciones/preview-dias?desde=${form.fecha_desde}&hasta=${form.fecha_hasta}${forzarQs}`,
      { cache: "no-store", signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { dias?: number; tipo_computo?: string; dias_naturales?: number; dias_laborables?: number } }) => {
        if (j?.success) setPreviewDias({
          dias: j.data?.dias ?? 0,
          tipo: j.data?.tipo_computo ?? "naturales",
          naturales: j.data?.dias_naturales ?? 0,
          laborables: j.data?.dias_laborables ?? 0,
        });
      })
      .catch(() => { /* tolerante */ });
    return () => ctrl.abort();
  }, [form.fecha_desde, form.fecha_hasta, modoComputo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.empleado_id) return;
    setSaving(true);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/vacaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleado_id: form.empleado_id,
          tipo_ausencia: form.tipo_ausencia,
          fecha_desde: form.fecha_desde,
          fecha_hasta: form.fecha_hasta,
          observacion: form.observacion,
          origen: form.origen,
          forzar_computo: modoComputo !== "auto" ? modoComputo : undefined,
          // Siempre admin: no hay flujo de aprobación en este MVP. El registro
          // queda directamente aprobado.
          modo: "admin",
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (r.ok && j.success) {
        setForm({ ...form, observacion: "" });
        await load();
      } else {
        setErr(j.error ?? "No se pudo guardar");
      }
    } finally { setSaving(false); }
  }

  async function cambiarEstado(id: string, estado: Estado) {
    const r = await fetchWithSupabaseSession(`/api/rrhh/vacaciones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) { setErr(j.error ?? "No se pudo cambiar estado"); return; }
    await load();
  }

  const nombreFiltrado = empleadoFiltro ? empleados.find((e) => e.id === empleadoFiltro)?.nombre ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · RRHH"
        title="Vacaciones"
        description="Solicitudes, aprobaciones, calendario y saldos por empleado."
        backHref="/rrhh"
        backLabel="RRHH"
        actions={
          <Link href="/configuracion/rrhh/vacaciones"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Política
          </Link>
        }
      />

      {err && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      {nombreFiltrado && (
        <div className="flex items-center gap-2 rounded-lg border border-[#4FAEB2]/30 bg-[#E5F4F4] px-3 py-2 text-xs">
          <span className="font-medium text-[#3F8E91]">Filtro: {nombreFiltrado}</span>
          <Link href="/rrhh/vacaciones" className="ml-auto text-[#3F8E91] underline">Quitar</Link>
        </div>
      )}

      {empleados.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Cargá primero empleados desde <a href="/rrhh/empleados" className="font-medium text-[#3F8E91] underline">RRHH → Empleados</a>.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">Registrar vacaciones</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className={lblCls}>Empleado</label>
              <select className={inputCls} value={form.empleado_id} required
                onChange={(e) => setForm({ ...form, empleado_id: e.target.value })}>
                <option value="">Seleccionar…</option>
                {empleados.map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` — ${e.cargo}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lblCls}>Tipo</label>
              <select className={inputCls} value={form.tipo_ausencia}
                onChange={(e) => setForm({ ...form, tipo_ausencia: e.target.value as Tipo })}>
                {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (
                  <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lblCls}>Desde</label>
              <input type="date" className={inputCls} value={form.fecha_desde}
                onChange={(e) => setForm({ ...form, fecha_desde: e.target.value })} />
            </div>
            <div>
              <label className={lblCls}>Hasta</label>
              <input type="date" className={inputCls} value={form.fecha_hasta} min={form.fecha_desde}
                onChange={(e) => setForm({ ...form, fecha_hasta: e.target.value })} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className={lblCls}>Observación</label>
              <input className={inputCls} value={form.observacion}
                placeholder="Ej. Vacaciones anuales, motivo personal"
                onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
            </div>
            <div>
              <label className={lblCls}>Origen</label>
              <select className={inputCls} value={form.origen}
                onChange={(e) => setForm({ ...form, origen: e.target.value as "empleado" | "empresa" })}>
                <option value="empleado">Solicitado por empleado</option>
                <option value="empresa">Definido por empresa</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
            {previewDias && (previewDias.naturales > 0 || previewDias.laborables > 0) && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Contar:</span>
                  <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden">
                    <button type="button" onClick={() => setModoComputo("laborables")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        (modoComputo === "laborables" || (modoComputo === "auto" && previewDias.tipo === "laborables"))
                          ? "bg-[#4FAEB2] text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}>
                      Solo laborables
                    </button>
                    <button type="button" onClick={() => setModoComputo("naturales")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        (modoComputo === "naturales" || (modoComputo === "auto" && previewDias.tipo === "naturales"))
                          ? "bg-[#4FAEB2] text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}>
                      Naturales (con fines de semana)
                    </button>
                  </div>
                </div>
                <span className="text-xs text-slate-600">
                  Días: <strong>{previewDias.dias}</strong> {previewDias.tipo === "laborables" ? "laborables" : "naturales"}
                  <span className="text-slate-400"> · Compara: {previewDias.laborables} laborables / {previewDias.naturales} naturales</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Referencia España (convenio general): 22 laborables ≈ 30 naturales al año.
                </span>
              </div>
            )}
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ml-auto">
              {saving ? "Guardando…" : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {/* Tabs + buscador */}
      <div className="flex items-end justify-between gap-3 flex-wrap border-b border-slate-200 pb-1">
        <div className="flex items-center gap-2">
          {(["lista", "saldos"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {t === "lista" ? "Listado" : "Saldos por empleado"}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar empleado…"
          className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
        />
      </div>

      {tab === "lista" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Empleado</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Tipo</th>
                <th className="px-4 py-3 font-semibold">Desde</th>
                <th className="px-4 py-3 font-semibold">Hasta</th>
                <th className="px-4 py-3 font-semibold text-right">Días</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(() => {
                const q = busqueda.trim().toLowerCase();
                const filas = q
                  ? solicitudes.filter((s) => (s.empleado_nombre ?? "").toLowerCase().includes(q))
                  : solicitudes;
                if (loading) {
                  return <tr><td colSpan={7} className="py-10 text-center text-gray-400">Cargando…</td></tr>;
                }
                if (filas.length === 0) {
                  return <tr><td colSpan={7} className="py-10 text-center text-gray-400">{q ? "Ningún empleado coincide" : "Sin registros"}</td></tr>;
                }
                return filas.map((s) => (
                  <tr key={s.id} className="hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {s.empleado_nombre ?? "—"}
                      {s.empleado_cargo && <span className="block text-[10px] text-slate-400">{s.empleado_cargo}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 hidden md:table-cell">{TIPO_LABEL[(s.tipo_ausencia ?? "vacaciones") as Tipo]}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs tabular-nums">{fmtFecha(s.fecha_desde)}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs tabular-nums">{fmtFecha(s.fecha_hasta)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{s.dias}</td>
                    <td className="px-4 py-2.5"><EstadoBadge estado={s.estado} /></td>
                    <td className="px-4 py-2.5 text-right">
                      {s.estado === "aprobada" ? (
                        <button onClick={() => void cambiarEstado(s.id, "cancelada")}
                          className="text-xs text-red-700 hover:underline">cancelar</button>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Empleado</th>
                <th className="px-4 py-3 font-semibold text-right">Anuales</th>
                <th className="px-4 py-3 font-semibold text-right">Generados</th>
                <th className="px-4 py-3 font-semibold text-right">Usados</th>
                <th className="px-4 py-3 font-semibold text-right">Disponibles</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Próxima ausencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(() => {
                const q = busqueda.trim().toLowerCase();
                const filas = q
                  ? saldos.filter((s) => s.empleado_nombre.toLowerCase().includes(q))
                  : saldos;
                if (filas.length === 0) {
                  return <tr><td colSpan={6} className="py-10 text-center text-gray-400">{q ? "Ningún empleado coincide" : "Sin empleados activos"}</td></tr>;
                }
                return filas.map((s) => (
                  <tr key={s.empleado_id} className="hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {s.empleado_nombre}
                      {s.cargo && <span className="block text-[10px] text-slate-400">{s.cargo}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.dias_anuales}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{s.dias_generados}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{s.dias_usados}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{s.dias_disponibles}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 hidden md:table-cell">
                      {s.proxima_ausencia_desde
                        ? `${fmtFecha(s.proxima_ausencia_desde)} → ${fmtFecha(s.proxima_ausencia_hasta!)}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const cfg: Record<Estado, { bg: string; text: string; label: string }> = {
    pendiente: { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente" },
    aprobada:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada" },
    rechazada: { bg: "bg-red-50",     text: "text-red-700",     label: "Rechazada" },
    cancelada: { bg: "bg-slate-100",  text: "text-slate-600",   label: "Cancelada" },
  };
  const c = cfg[estado];
  return (
    <span className={`rounded-full ${c.bg} px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.text}`}>
      {c.label}
    </span>
  );
}

