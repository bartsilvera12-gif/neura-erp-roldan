"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { Iniciales } from "@/components/rrhh/EmpleadoBadges";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatFecha as fmtFecha } from "@/lib/fecha/asuncion";
import { AlertTriangle, CalendarClock, CalendarDays, Clock, FileSignature, Palmtree, Scale, Search } from "lucide-react";
import Selector from "@/components/ui/Selector";

export const dynamic = "force-dynamic";

type Empleado = { id: string; nombre: string; cargo: string | null; estado?: string };
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

/** Ver lib/rrhh/vacaciones-py.ts → SaldoVacacionesPy. */
type Saldo = {
  empleado_id: string;
  empleado_nombre: string;
  cargo: string | null;
  fecha_ingreso: string | null;
  anios: number;
  antiguedad: string | null;
  dias_por_anio: number;
  dias_generados: number;
  dias_usados: number;
  dias_disponibles: number;
  vigente_desde: string | null;
  proximo_derecho_fecha: string | null;
  proximo_derecho_dias: number;
  dias_pendientes_aprobacion: number;
  proxima_ausencia_desde: string | null;
  proxima_ausencia_hasta: string | null;
};

type Kpis = { de_vacaciones_hoy: number; solicitudes_pendientes: number; proximas: number; sin_fecha_ingreso: number };

// Los valores en la base siguen siendo los de antes; lo que cambia es cómo se
// llaman acá. "Baja médica" y "permiso retribuido" son de España.
const TIPO_LABEL: Record<Tipo, string> = {
  vacaciones: "Vacaciones",
  permiso_retribuido: "Permiso con goce de sueldo",
  baja_medica: "Reposo médico",
  ausencia_sin_sueldo: "Permiso sin goce de sueldo",
  otro: "Otro",
};

const TIPO_COLOR: Record<Tipo, string> = {
  vacaciones: "bg-[#4FAEB2]/10 text-[#3F8E91]",
  permiso_retribuido: "bg-sky-50 text-sky-700",
  baja_medica: "bg-rose-50 text-rose-700",
  ausencia_sin_sueldo: "bg-amber-50 text-amber-700",
  otro: "bg-slate-100 text-slate-600",
};

function hoyPy() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const lblCls = "mb-1 block text-xs font-medium text-slate-600";

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
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<{ texto: string; constancia?: string } | null>(null);
  const [tab, setTab] = useState<"saldos" | "lista">("saldos");
  const [preview, setPreview] = useState<{ dias: number; computo: string; corridos: number } | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [form, setForm] = useState({
    empleado_id: empleadoFiltro,
    tipo_ausencia: "vacaciones" as Tipo,
    fecha_desde: hoyPy(),
    fecha_hasta: hoyPy(),
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
      const jB = (await rB.json().catch(() => ({}))) as { success?: boolean; data?: { saldos?: Saldo[]; kpis?: Kpis } };
      // Solo los que trabajan: a uno de baja no se le registran vacaciones.
      if (rE.ok && jE.success) setEmpleados((jE.data?.empleados ?? []).filter((e) => e.estado !== "baja"));
      if (rS.ok && jS.success) setSolicitudes(jS.data?.solicitudes ?? []);
      else setErr(jS.error ?? "No se pudieron cargar las solicitudes");
      if (rB.ok && jB.success) {
        setSaldos(jB.data?.saldos ?? []);
        setKpis(jB.data?.kpis ?? null);
      }
    } finally { setLoading(false); }
  }, [empleadoFiltro]);

  useEffect(() => { void load(); }, [load]);

  // Cuántos días va a ocupar, contados igual que al guardar.
  useEffect(() => {
    if (!form.fecha_desde || !form.fecha_hasta) { setPreview(null); return; }
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ desde: form.fecha_desde, hasta: form.fecha_hasta, tipo: form.tipo_ausencia });
    fetchWithSupabaseSession(`/api/rrhh/vacaciones/preview-dias?${qs}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { dias?: number; computo?: string; dias_corridos?: number } }) => {
        if (j?.success) setPreview({ dias: j.data?.dias ?? 0, computo: j.data?.computo ?? "habiles", corridos: j.data?.dias_corridos ?? 0 });
      })
      .catch(() => { /* tolerante */ });
    return () => ctrl.abort();
  }, [form.fecha_desde, form.fecha_hasta, form.tipo_ausencia]);

  const saldoSel = useMemo(() => saldos.find((s) => s.empleado_id === form.empleado_id) ?? null, [saldos, form.empleado_id]);
  const excede = form.tipo_ausencia === "vacaciones" && saldoSel && preview ? preview.dias > saldoSel.dias_disponibles : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.empleado_id) return;
    setSaving(true);
    setErr(null);
    setOk(null);
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
          // No hay flujo de aprobación: lo que se registra acá queda aprobado.
          modo: "admin",
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { dias_calculados?: number; solicitud?: { id?: string } } };
      if (r.ok && j.success) {
        setForm({ ...form, observacion: "" });
        // Vacaciones: se ofrece la hoja para que firme, que es lo que sigue.
        const idNuevo = j.data?.solicitud?.id;
        setOk({
          texto: `Registrado: ${j.data?.dias_calculados ?? ""} días.`,
          constancia: form.tipo_ausencia === "vacaciones" && idNuevo ? `/api/rrhh/vacaciones/${idNuevo}/constancia` : undefined,
        });
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

  /** Corrige fechas de una solicitud ya cargada. */
  async function editarSolicitud(s: Solicitud) {
    const desde = window.prompt("Fecha de inicio (AAAA-MM-DD):", String(s.fecha_desde ?? "").slice(0, 10));
    if (desde == null) return;
    const hasta = window.prompt("Fecha de fin (AAAA-MM-DD):", String(s.fecha_hasta ?? "").slice(0, 10));
    if (hasta == null) return;
    const obs = window.prompt("Observación:", s.observacion ?? "");
    if (obs == null) return;
    const r = await fetchWithSupabaseSession(`/api/rrhh/vacaciones/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha_desde: desde.trim(), fecha_hasta: hasta.trim(), observacion: obs }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) { setErr(j.error ?? "No se pudo editar la solicitud"); return; }
    await load();
  }

  const nombreFiltrado = empleadoFiltro ? empleados.find((e) => e.id === empleadoFiltro)?.nombre ?? null : null;
  const q = busqueda.trim().toLowerCase();
  const saldosVista = q ? saldos.filter((s) => s.empleado_nombre.toLowerCase().includes(q)) : saldos;
  const solicitudesVista = q ? solicitudes.filter((s) => (s.empleado_nombre ?? "").toLowerCase().includes(q)) : solicitudes;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RRHH"
        title="Vacaciones"
        description="Saldos según la ley paraguaya, vacaciones tomadas, permisos y reposos."
        backHref="/rrhh"
        backLabel="RRHH"
        actions={
          <Link href="/configuracion/rrhh/vacaciones"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Scale className="h-3.5 w-3.5" /> Política
          </Link>
        }
      />

      {err && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}
      {ok && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <span>{ok.texto}</span>
          {ok.constancia && (
            <a href={ok.constancia} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
              <FileSignature className="h-3.5 w-3.5" /> Imprimir la comunicación para firmar
            </a>
          )}
          <button type="button" onClick={() => setOk(null)} className="ml-auto text-xs text-emerald-700/70 hover:text-emerald-800">Cerrar</button>
        </div>
      )}

      {nombreFiltrado && (
        <div className="flex items-center gap-2 rounded-lg border border-[#4FAEB2]/30 bg-[#E5F4F4] px-3 py-2 text-xs">
          <span className="font-medium text-[#3F8E91]">Filtro: {nombreFiltrado}</span>
          <Link href="/rrhh/vacaciones" className="ml-auto text-[#3F8E91] underline">Quitar</Link>
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard compact label="De vacaciones hoy" value={kpis.de_vacaciones_hoy} icon={<Palmtree className="h-4 w-4" />} accent />
          <StatCard compact label="Próximas" value={kpis.proximas} icon={<CalendarClock className="h-4 w-4" />} hint="ya registradas, a futuro" />
          <StatCard compact label="Pendientes de aprobar" value={kpis.solicitudes_pendientes} icon={<Clock className="h-4 w-4" />} />
          <StatCard compact label="Sin fecha de ingreso" value={kpis.sin_fecha_ingreso} icon={<AlertTriangle className="h-4 w-4" />}
            hint={kpis.sin_fecha_ingreso > 0 ? "sin ella no se calcula el saldo" : "todos la tienen"} />
        </div>
      )}

      {empleados.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Cargá primero empleados desde <Link href="/rrhh/empleados" className="font-medium text-[#3F8E91] underline">RRHH → Empleados</Link>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarDays className="h-4 w-4 text-[#3F8E91]" /> Registrar ausencia
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={lblCls}>Empleado</label>
                <Selector className={inputCls} value={form.empleado_id} required
                  onChange={(e) => setForm({ ...form, empleado_id: e.target.value })}>
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` — ${e.cargo}` : ""}</option>
                  ))}
                </Selector>
              </div>
              <div>
                <label className={lblCls}>Tipo</label>
                <Selector className={inputCls} value={form.tipo_ausencia}
                  onChange={(e) => setForm({ ...form, tipo_ausencia: e.target.value as Tipo })}>
                  {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </Selector>
              </div>
              <div>
                <label className={lblCls}>Desde</label>
                <input type="date" className={inputCls} value={form.fecha_desde}
                  onChange={(e) => setForm({ ...form, fecha_desde: e.target.value, fecha_hasta: e.target.value > form.fecha_hasta ? e.target.value : form.fecha_hasta })} />
              </div>
              <div>
                <label className={lblCls}>Hasta</label>
                <input type="date" className={inputCls} value={form.fecha_hasta} min={form.fecha_desde}
                  onChange={(e) => setForm({ ...form, fecha_hasta: e.target.value })} />
              </div>
              <div>
                <label className={lblCls}>Observación</label>
                <input className={inputCls} value={form.observacion} placeholder="Ej. vacaciones del período 2025"
                  onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
              </div>
              <div>
                <label className={lblCls}>Quién lo decidió</label>
                <Selector className={inputCls} value={form.origen}
                  onChange={(e) => setForm({ ...form, origen: e.target.value as "empleado" | "empresa" })}>
                  <option value="empleado">Lo pidió el empleado</option>
                  <option value="empresa">Lo fijó la empresa</option>
                </Selector>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="text-sm">
                {preview && preview.corridos > 0 && (
                  <>
                    <span className="text-slate-700">
                      <b className="text-lg text-slate-900">{preview.dias}</b>{" "}
                      {preview.computo === "habiles" ? "días hábiles" : "días corridos"}
                    </span>
                    {preview.computo === "habiles" && (
                      <span className="ml-2 text-xs text-slate-400">
                        de lunes a sábado, sin domingos ni feriados · {preview.corridos} corridos
                      </span>
                    )}
                  </>
                )}
                {excede && saldoSel && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {saldoSel.anios === 0
                      ? `Todavía no cumplió su primer año (lo cumple el ${fmtFecha(saldoSel.proximo_derecho_fecha ?? "")}).`
                      : `Tiene ${Math.max(0, saldoSel.dias_disponibles)} días disponibles.`}{" "}
                    Solo se puede si la política permite adelantar vacaciones.
                  </p>
                )}
              </div>
              <button type="submit" disabled={saving || !form.empleado_id}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
                {saving ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </form>

          {/* A la derecha: el saldo del elegido, o la regla de la ley. */}
          <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {saldoSel ? (
              <>
                <div className="flex items-center gap-3">
                  <Iniciales nombre={saldoSel.empleado_nombre} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{saldoSel.empleado_nombre}</p>
                    <p className="text-xs text-slate-500">
                      {saldoSel.antiguedad ? `${saldoSel.antiguedad} de antigüedad` : "Sin fecha de ingreso"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-[#4FAEB2]/5 p-4 text-center">
                  <p className={`text-3xl font-bold tabular-nums ${saldoSel.dias_disponibles < 0 ? "text-amber-600" : "text-[#3F8E91]"}`}>
                    {saldoSel.dias_disponibles}
                  </p>
                  <p className="text-xs text-slate-500">días hábiles disponibles</p>
                </div>
                <dl className="mt-4 space-y-1.5 text-xs">
                  <Fila k="Le corresponden por año" v={`${saldoSel.dias_por_anio} días`} />
                  <Fila k="Períodos vigentes" v={saldoSel.anios >= 1 ? `${saldoSel.dias_generados} días desde ${fmtFecha(saldoSel.vigente_desde ?? "")}` : "Ninguno todavía"} />
                  <Fila k="Tomados en ese lapso" v={`${saldoSel.dias_usados} días`} />
                  {saldoSel.proximo_derecho_fecha && (
                    <Fila k="Próximo derecho" v={`${fmtFecha(saldoSel.proximo_derecho_fecha)} · ${saldoSel.proximo_derecho_dias} días`} />
                  )}
                </dl>
              </>
            ) : (
              <>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Scale className="h-4 w-4 text-[#3F8E91]" /> Cuántos días corresponden
                </h3>
                <p className="mt-1 text-xs text-slate-500">Código del Trabajo, art. 218. Por cada año trabajado:</p>
                <div className="mt-3 space-y-2">
                  {[["Hasta 5 años", 12], ["De 5 a 10 años", 18], ["Más de 10 años", 30]].map(([a, d]) => (
                    <div key={a} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <span className="text-slate-600">{a}</span>
                      <span className="font-semibold text-slate-800">{d} días</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Días hábiles: lunes a sábado. El primer período se gana al cumplir un año. Elegí un empleado para ver su saldo.
                </p>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Solapas + buscador */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-1">
          {(["saldos", "lista"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {t === "saldos" ? "Saldos por empleado" : `Registros (${solicitudes.length})`}
            </button>
          ))}
        </div>
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar empleado…"
            className="w-56 rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30" />
        </div>
      </div>

      {tab === "saldos" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Empleado</th>
                <th className="px-4 py-3">Ingreso</th>
                <th className="px-4 py-3 text-right">Por año</th>
                <th className="px-4 py-3 text-right">Vigentes</th>
                <th className="px-4 py-3 text-right">Tomados</th>
                <th className="px-4 py-3 text-right">Disponibles</th>
                <th className="px-4 py-3">Próximo derecho</th>
                <th className="hidden px-4 py-3 md:table-cell">Próxima ausencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : saldosVista.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400">{q ? "Ningún empleado coincide" : "Sin empleados activos"}</td></tr>
              ) : saldosVista.map((s) => (
                <tr key={s.empleado_id} className="hover:bg-[#4FAEB2]/[0.04]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Iniciales nombre={s.empleado_nombre} />
                      <div className="min-w-0">
                        <Link href={`/rrhh/empleados/${s.empleado_id}`} className="block truncate font-medium text-slate-800 hover:text-[#3F8E91]">
                          {s.empleado_nombre}
                        </Link>
                        <span className="block text-xs text-slate-400">{s.cargo ?? "—"}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.fecha_ingreso ? (
                      <>
                        <span className="block text-slate-700">{fmtFecha(s.fecha_ingreso)}</span>
                        <span className="block text-xs text-slate-400">{s.antiguedad}</span>
                      </>
                    ) : (
                      <Link href={`/rrhh/empleados/${s.empleado_id}`} className="text-xs font-medium text-amber-700 hover:underline">
                        Falta cargarla
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{s.dias_por_anio}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{s.dias_generados}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{s.dias_usados}</td>
                  <td className="px-4 py-3 text-right">
                    {s.dias_disponibles < 0 ? (
                      <span className="inline-flex flex-col items-end">
                        <span className="font-semibold tabular-nums text-amber-600">{s.dias_disponibles}</span>
                        <span className="text-[10px] text-amber-600">adelantados</span>
                      </span>
                    ) : (
                      <span className="rounded-md bg-[#4FAEB2]/10 px-2 py-0.5 font-semibold tabular-nums text-[#3F8E91]">{s.dias_disponibles}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.proximo_derecho_fecha && s.fecha_ingreso
                      ? <>{fmtFecha(s.proximo_derecho_fecha)} <span className="text-slate-400">· +{s.proximo_derecho_dias}</span></>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-600 md:table-cell">
                    {s.proxima_ausencia_desde
                      ? `${fmtFecha(s.proxima_ausencia_desde)} → ${fmtFecha(s.proxima_ausencia_hasta!)}`
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
            Vigentes: los días de los dos últimos años cumplidos (se acumulan hasta dos períodos). Tomados: vacaciones
            registradas desde que empezó el período vigente más viejo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Empleado</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="w-28 px-4 py-3">Desde</th>
                <th className="w-28 px-4 py-3">Hasta</th>
                <th className="w-16 px-4 py-3 text-right">Días</th>
                <th className="w-28 px-4 py-3">Estado</th>
                <th className="w-32 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : solicitudesVista.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400">{q ? "Ningún empleado coincide" : "Sin registros"}</td></tr>
              ) : solicitudesVista.map((s) => {
                const t = (s.tipo_ausencia ?? "vacaciones") as Tipo;
                return (
                  <tr key={s.id} className="hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {s.empleado_nombre ?? "—"}
                      {s.observacion && <span className="block max-w-[260px] truncate text-xs font-normal text-slate-400">{s.observacion}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TIPO_COLOR[t]}`}>{TIPO_LABEL[t]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-slate-600">{fmtFecha(s.fecha_desde)}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-slate-600">{fmtFecha(s.fecha_hasta)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{s.dias}</td>
                    <td className="px-4 py-2.5"><EstadoBadge estado={s.estado} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {t === "vacaciones" && (s.estado === "aprobada" || s.estado === "pendiente") && (
                        <a href={`/api/rrhh/vacaciones/${s.id}/constancia`} target="_blank" rel="noreferrer"
                          title="Hoja de comunicación de vacaciones para que firme el trabajador"
                          className="mr-3 inline-flex items-center gap-1 text-xs font-medium text-[#3F8E91] hover:underline">
                          <FileSignature className="h-3.5 w-3.5" /> comunicación
                        </a>
                      )}
                      <button onClick={() => void editarSolicitud(s)} className="text-xs text-sky-700 hover:underline">editar</button>
                      {s.estado === "aprobada" && (
                        <button onClick={() => void cambiarEstado(s.id, "cancelada")} className="ml-3 text-xs text-red-700 hover:underline">cancelar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-700">{v}</dd>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const cfg: Record<Estado, { cls: string; label: string }> = {
    pendiente: { cls: "bg-amber-50 text-amber-700 ring-amber-200", label: "Pendiente" },
    aprobada: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Aprobada" },
    rechazada: { cls: "bg-red-50 text-red-700 ring-red-200", label: "Rechazada" },
    cancelada: { cls: "bg-slate-100 text-slate-600 ring-slate-200", label: "Cancelada" },
  };
  const c = cfg[estado];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${c.cls}`}>{c.label}</span>;
}
