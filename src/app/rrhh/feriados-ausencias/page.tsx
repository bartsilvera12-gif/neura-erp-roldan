"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Iniciales } from "@/components/rrhh/EmpleadoBadges";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { diasCorridos, feriadosFijosPy } from "@/lib/rrhh/vacaciones-py";
import { AlertTriangle, CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Flag, HeartPulse, Plus, Search, Trash2, UserX, X } from "lucide-react";
import {
  TOPE_AUSENCIAS, VENTANA_DIAS, contarEnVentana, estadoDelTope, lugarEnLaVentana,
  pasadosDelTope, textoDelTope,
} from "@/lib/rrhh/tope-ausencias";
import Selector from "@/components/ui/Selector";

export const dynamic = "force-dynamic";

/**
 * Feriados y ausencias, en dos solapas del mismo módulo.
 *
 * Antes era una sola pantalla con los dos formularios arriba de todo y los
 * listados sin filtro. Ahora cada solapa tiene su listado, sus filtros y un
 * botón que abre el formulario solo cuando hace falta.
 */

type Feriado = { id: string; fecha: string; nombre: string; ambito: string };
type TipoAusencia = "reposo" | "vacaciones" | "permiso" | "baja" | "otro";
type Ausencia = {
  id: string;
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: TipoAusencia;
  observacion: string | null;
  empleados?: { nombre?: string } | { nombre?: string }[] | null;
};
type Empleado = { id: string; nombre: string; cargo?: string | null; estado?: string };

const TIPO: Record<TipoAusencia, { label: string; cls: string }> = {
  reposo: { label: "Reposo médico", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  permiso: { label: "Permiso", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  otro: { label: "Otro", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  // Ya no se ofrecen al cargar; se siguen mostrando los que existen.
  vacaciones: { label: "Vacaciones", cls: "bg-[#4FAEB2]/10 text-[#3F8E91] ring-[#4FAEB2]/30" },
  baja: { label: "Baja", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};
/** Las vacaciones van en su módulo: acá no descontaban del saldo. */
const TIPOS_CARGA: TipoAusencia[] = ["reposo", "permiso", "otro"];

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const NOMBRES_FIJOS: Record<string, string> = {
  "01-01": "Año Nuevo",
  "05-01": "Día del Trabajador",
  "05-14": "Independencia Nacional",
  "05-15": "Independencia Nacional · Día de la Madre",
  "08-15": "Fundación de Asunción",
  "12-08": "Virgen de Caacupé",
  "12-25": "Navidad",
};

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const lblCls = "mb-1 block text-xs font-medium text-slate-600";

function hoyPy() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function fmtFecha(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function diaSemana(iso: string) {
  return DIAS_SEMANA[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];
}
function empleadoNombre(a: Ausencia): string {
  const e = a.empleados;
  if (!e) return "—";
  return (Array.isArray(e) ? e[0]?.nombre : e.nombre) ?? "—";
}

export default function FeriadosAusenciasPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Cargando…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab: "ausencias" | "feriados" = sp?.get("tab") === "feriados" ? "feriados" : "ausencias";
  const irA = (t: "ausencias" | "feriados") => router.replace(t === "feriados" ? "?tab=feriados" : "?", { scroll: false });

  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [borrar, setBorrar] = useState<{ tipo: "feriado" | "ausencia"; id: string; texto: string } | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [fR, aR, eR] = await Promise.all([
        fetchWithSupabaseSession("/api/rrhh/feriados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/rrhh/ausencias", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/rrhh/empleados", { cache: "no-store" }),
      ]);
      const [fJ, aJ, eJ] = await Promise.all([fR.json(), aR.json(), eR.json()]);
      if (fJ.success) setFeriados(fJ.data?.feriados ?? []);
      if (aJ.success) setAusencias(aJ.data?.ausencias ?? []);
      setEmpleados((eJ.data?.empleados ?? []) as Empleado[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const avisar = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    if (ok) setTimeout(() => setMsg(null), 3000);
  };

  async function confirmarBorrar() {
    if (!borrar) return;
    setBorrando(true);
    const url = borrar.tipo === "feriado" ? "/api/rrhh/feriados" : "/api/rrhh/ausencias";
    const r = await fetchWithSupabaseSession(`${url}?id=${encodeURIComponent(borrar.id)}`, { method: "DELETE" });
    setBorrando(false);
    setBorrar(null);
    if (r.ok) { avisar(true, "Eliminado."); void cargar(); }
    else avisar(false, "No se pudo eliminar.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RRHH"
        title="Feriados y ausencias"
        description="Reposos, permisos y los días que no se trabaja. Se ven en el control horario y descuentan bien las vacaciones."
      />

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ["ausencias", "Ausencias", <UserX key="a" className="h-4 w-4" />, ausencias.length],
          ["feriados", "Feriados", <Flag key="f" className="h-4 w-4" />, feriados.length],
        ] as const).map(([t, label, icon, n]) => (
          <button key={t} type="button" onClick={() => irA(t)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}>
            {icon} {label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t ? "bg-[#4FAEB2]/10" : "bg-slate-100"}`}>{n}</span>
          </button>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{msg.text}</div>
      )}

      {tab === "ausencias" ? (
        <TabAusencias ausencias={ausencias} empleados={empleados} loading={loading} avisar={avisar} recargar={cargar}
          onBorrar={(a) => setBorrar({ tipo: "ausencia", id: a.id, texto: `la ausencia de ${empleadoNombre(a)} (${fmtFecha(a.fecha_desde)} al ${fmtFecha(a.fecha_hasta)})` })} />
      ) : (
        <TabFeriados feriados={feriados} loading={loading} avisar={avisar} recargar={cargar}
          onBorrar={(f) => setBorrar({ tipo: "feriado", id: f.id, texto: `el feriado del ${fmtFecha(f.fecha)} (${f.nombre})` })} />
      )}

      <ConfirmModal
        open={borrar !== null}
        title="Eliminar"
        message={borrar ? `¿Eliminar ${borrar.texto}?` : undefined}
        confirmLabel="Eliminar"
        tone="danger"
        loading={borrando}
        onConfirm={confirmarBorrar}
        onCancel={() => setBorrar(null)}
      />
    </div>
  );
}

/* ── Ausencias ─────────────────────────────────────────────────────── */

function TabAusencias({ ausencias, empleados, loading, avisar, recargar, onBorrar }: {
  ausencias: Ausencia[];
  empleados: Empleado[];
  loading: boolean;
  avisar: (ok: boolean, t: string) => void;
  recargar: () => Promise<void>;
  onBorrar: (a: Ausencia) => void;
}) {
  const hoy = hoyPy();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({ empleado_id: "", fecha_desde: hoy, fecha_hasta: hoy, tipo: "reposo" as TipoAusencia, observacion: "" });
  const [fEmpleado, setFEmpleado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fCuando, setFCuando] = useState<"todas" | "actuales" | "proximas" | "pasadas">("todas");
  const [fMes, setFMes] = useState("");
  const [q, setQ] = useState("");

  const activos = empleados.filter((e) => e.estado !== "baja");

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ausencias.filter((a) => {
      if (fEmpleado && a.empleado_id !== fEmpleado) return false;
      if (fTipo && a.tipo !== fTipo) return false;
      if (fCuando === "actuales" && !(a.fecha_desde <= hoy && a.fecha_hasta >= hoy)) return false;
      if (fCuando === "proximas" && !(a.fecha_desde > hoy)) return false;
      if (fCuando === "pasadas" && !(a.fecha_hasta < hoy)) return false;
      // Del mes: si el rango toca algún día del mes elegido.
      if (fMes && !(a.fecha_desde.slice(0, 7) <= fMes && a.fecha_hasta.slice(0, 7) >= fMes)) return false;
      if (t && !(empleadoNombre(a).toLowerCase().includes(t) || (a.observacion ?? "").toLowerCase().includes(t))) return false;
      return true;
    });
  }, [ausencias, fEmpleado, fTipo, fCuando, fMes, q, hoy]);

  // ── El tope: 3 ausencias cada 30 días, por persona ──────────────────────
  //
  // El lugar de cada ausencia se calcula sobre TODAS las cargadas, no sobre
  // las filtradas: si se calculara sobre lo filtrado, filtrar por mes borraría
  // las de la semana anterior y la cuarta dejaría de salir en rojo.
  const lugares = useMemo(() => lugarEnLaVentana(ausencias), [ausencias]);
  const pasados = useMemo(() => pasadosDelTope(ausencias, hoy), [ausencias, hoy]);
  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empleados) m.set(e.id, e.nombre);
    for (const a of ausencias) if (!m.has(a.empleado_id)) m.set(a.empleado_id, empleadoNombre(a));
    return m;
  }, [empleados, ausencias]);

  // Lo que pasaría si se guarda la que se está cargando. Se avisa ANTES: el
  // que la carga es el que puede ir a preguntar qué pasó.
  const topeDelForm = useMemo(() => {
    if (!form.empleado_id) return null;
    const estado = estadoDelTope(ausencias, form.empleado_id, form.fecha_desde || hoy);
    const seria = contarEnVentana(ausencias, form.empleado_id, form.fecha_desde || hoy) + 1;
    return { estado, seria, pasaria: seria > TOPE_AUSENCIAS };
  }, [ausencias, form.empleado_id, form.fecha_desde, hoy]);

  const hayFiltros = Boolean(fEmpleado || fTipo || fCuando !== "todas" || fMes || q);
  const ausentesHoy = ausencias.filter((a) => a.fecha_desde <= hoy && a.fecha_hasta >= hoy);
  const mesActual = hoy.slice(0, 7);
  const delMes = ausencias.filter((a) => a.fecha_desde.slice(0, 7) <= mesActual && a.fecha_hasta.slice(0, 7) >= mesActual);
  const diasReposoMes = delMes.filter((a) => a.tipo === "reposo").reduce((s, a) => {
    const ini = a.fecha_desde.slice(0, 7) < mesActual ? `${mesActual}-01` : a.fecha_desde;
    const finMes = new Date(Date.UTC(Number(mesActual.slice(0, 4)), Number(mesActual.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const fin = a.fecha_hasta > finMes ? finMes : a.fecha_hasta;
    return s + diasCorridos(ini, fin);
  }, 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.empleado_id) { avisar(false, "Elegí el empleado."); return; }
    setGuardando(true);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/ausencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.success) { avisar(false, j.error ?? "No se pudo guardar"); return; }
      avisar(true, "Ausencia registrada.");
      setForm({ empleado_id: "", fecha_desde: hoy, fecha_hasta: hoy, tipo: form.tipo, observacion: "" });
      setAbierto(false);
      await recargar();
    } finally {
      setGuardando(false);
    }
  }

  const dias = diasCorridos(form.fecha_desde, form.fecha_hasta);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard compact label="Ausentes hoy" value={ausentesHoy.length} icon={<UserX className="h-4 w-4" />} accent
          hint={ausentesHoy.length ? ausentesHoy.map(empleadoNombre).slice(0, 2).join(", ") + (ausentesHoy.length > 2 ? "…" : "") : "todos presentes"} />
        <StatCard compact label="Ausencias del mes" value={delMes.length} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard compact label="Días de reposo del mes" value={diasReposoMes} icon={<HeartPulse className="h-4 w-4" />} hint="días corridos" />
        <StatCard compact label="Próximas" value={ausencias.filter((a) => a.fecha_desde > hoy).length} icon={<CalendarOff className="h-4 w-4" />} hint="ya registradas" />
      </div>

      {/* El aviso en rojo. Va arriba de todo y solo aparece cuando alguien se
          pasó: un aviso que está siempre deja de leerse. */}
      {pasados.length > 0 && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {pasados.length === 1
              ? "Una persona pasó el tope de ausencias"
              : `${pasados.length} personas pasaron el tope de ausencias`}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {pasados.map((p) => (
              <li key={p.empleado_id}>
                <button
                  type="button"
                  onClick={() => { setFEmpleado(p.empleado_id); setFCuando("todas"); setFMes(""); }}
                  className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 hover:bg-rose-100"
                  title="Ver sus ausencias"
                >
                  {nombrePorId.get(p.empleado_id) ?? "—"}
                  <span className="ml-1.5 font-semibold tabular-nums">{p.usadas}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-rose-800">
            El tope es {TOPE_AUSENCIAS} ausencias cada {VENTANA_DIAS} días por persona. Son {VENTANA_DIAS} días
            móviles, no el mes: cuentan los últimos {VENTANA_DIAS} desde hoy. Las vacaciones no suman —van en
            su módulo y son un derecho—.
          </p>
        </div>
      )}

      {/* Formulario: se abre solo cuando hace falta */}
      {abierto ? (
        <form onSubmit={guardar} className="rounded-xl border border-[#4FAEB2]/30 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Registrar ausencia</h3>
            <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className={lblCls}>Empleado</label>
              <Selector className={inputCls} value={form.empleado_id} onChange={(e) => setForm({ ...form, empleado_id: e.target.value })} required>
                <option value="">Seleccionar…</option>
                {activos.map((e) => <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` — ${e.cargo}` : ""}</option>)}
              </Selector>
            </div>
            <div className="lg:col-span-2">
              <label className={lblCls}>Tipo</label>
              <div className="flex gap-1.5">
                {TIPOS_CARGA.map((t) => (
                  <button key={t} type="button" onClick={() => setForm({ ...form, tipo: t })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.tipo === t ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {TIPO[t].label}
                  </button>
                ))}
              </div>
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
            <div className="lg:col-span-2">
              <label className={lblCls}>Observación</label>
              <input className={inputCls} value={form.observacion} placeholder={form.tipo === "reposo" ? "Ej. certificado de IPS n.º …" : "Opcional"}
                onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
            </div>
          </div>
          {/* Cómo viene esa persona. Se avisa antes de guardar, no después. */}
          {topeDelForm && (
            <p className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              topeDelForm.pasaria
                ? "border-rose-300 bg-rose-50 font-medium text-rose-900"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}>
              {topeDelForm.pasaria && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
              <span>
                {topeDelForm.pasaria
                  ? `Con esta serían ${topeDelForm.seria} ausencias en ${VENTANA_DIAS} días: pasa el tope de ${TOPE_AUSENCIAS}.`
                  : textoDelTope(topeDelForm.estado)}
              </span>
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              {dias > 0 ? <><b className="text-slate-900">{dias}</b> {dias === 1 ? "día" : "días"} corridos</> : "Revisá las fechas"}
              <span className="ml-2 text-xs text-slate-400">
                ¿Vacaciones? Van en <Link href="/rrhh/vacaciones" className="text-[#3F8E91] hover:underline">Vacaciones</Link>, para que descuenten del saldo.
              </span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
              <button type="submit" disabled={guardando || dias <= 0}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
                {guardando ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empleado u observación…" className={`${inputCls} pl-9`} />
        </div>
        <Selector value={fEmpleado} onChange={(e) => setFEmpleado(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">Todos los empleados</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </Selector>
        <Selector value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO) as TipoAusencia[]).filter((t) => TIPOS_CARGA.includes(t) || ausencias.some((a) => a.tipo === t))
            .map((t) => <option key={t} value={t}>{TIPO[t].label}</option>)}
        </Selector>
        <input type="month" value={fMes} onChange={(e) => setFMes(e.target.value)} className={inputCls.replace("w-full", "w-auto")} title="Del mes" />
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {([["todas", "Todas"], ["actuales", "Hoy"], ["proximas", "Próximas"], ["pasadas", "Pasadas"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFCuando(v)}
              className={`rounded-lg px-2.5 py-1.5 font-medium ${fCuando === v ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        {hayFiltros && (
          <button type="button" onClick={() => { setFEmpleado(""); setFTipo(""); setFCuando("todas"); setFMes(""); setQ(""); }}
            className="text-xs text-slate-500 hover:text-slate-800">Limpiar</button>
        )}
        {!abierto && (
          <button type="button" onClick={() => setAbierto(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
            <Plus className="h-4 w-4" /> Registrar ausencia
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Empleado</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Fechas</th>
              <th className="px-4 py-3 text-right">Días</th>
              <th className="px-4 py-3">Observación</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">Cargando…</td></tr>
            ) : filtradas.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center">
                <UserX className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">{ausencias.length === 0 ? "Todavía no hay ausencias registradas." : "Ninguna ausencia coincide con los filtros."}</p>
              </td></tr>
            ) : filtradas.map((a) => {
              const enCurso = a.fecha_desde <= hoy && a.fecha_hasta >= hoy;
              const d = diasCorridos(a.fecha_desde, a.fecha_hasta);
              // El rojo va en la que se pasó, no en todo el bloque: las tres
              // primeras están permitidas, y pintarlas también haría que el
              // rojo no diga cuál fue la que se pasó.
              const lugar = lugares.get(a.id);
              const pasada = lugar?.pasada === true;
              return (
                <tr key={a.id} className={pasada ? "bg-rose-50/70 hover:bg-rose-50" : "hover:bg-[#4FAEB2]/[0.04]"}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Iniciales nombre={empleadoNombre(a)} />
                      <span className={`font-medium ${pasada ? "text-rose-900" : "text-slate-800"}`}>{empleadoNombre(a)}</span>
                      {pasada && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                          title={`Es la ${lugar!.orden}.ª ausencia en ${VENTANA_DIAS} días. El tope es ${TOPE_AUSENCIAS}.`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {lugar!.orden}.ª en {VENTANA_DIAS} días
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TIPO[a.tipo]?.cls ?? TIPO.otro.cls}`}>{TIPO[a.tipo]?.label ?? a.tipo}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {a.fecha_desde === a.fecha_hasta ? fmtFecha(a.fecha_desde) : `${fmtFecha(a.fecha_desde)} → ${fmtFecha(a.fecha_hasta)}`}
                    {enCurso && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">en curso</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{d}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-slate-500">{a.observacion ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onBorrar(a)} title="Eliminar" className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtradas.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
            {filtradas.length} de {ausencias.length} · {filtradas.reduce((s, a) => s + diasCorridos(a.fecha_desde, a.fecha_hasta), 0)} días en total
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Feriados ──────────────────────────────────────────────────────── */

function TabFeriados({ feriados, loading, avisar, recargar, onBorrar }: {
  feriados: Feriado[];
  loading: boolean;
  avisar: (ok: boolean, t: string) => void;
  recargar: () => Promise<void>;
  onBorrar: (f: Feriado) => void;
}) {
  const hoy = hoyPy();
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({ fecha: "", nombre: "" });
  const [guardando, setGuardando] = useState(false);
  const [cargandoNac, setCargandoNac] = useState(false);

  const delAnio = feriados.filter((f) => f.fecha.startsWith(String(anio))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const proximo = feriados.filter((f) => f.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
  const cargadas = new Set(feriados.map((f) => f.fecha.slice(0, 10)));
  const faltanNacionales = feriadosFijosPy(anio).filter((f) => !cargadas.has(f));
  const porMes = MESES.map((m, i) => ({ mes: m, items: delAnio.filter((f) => Number(f.fecha.slice(5, 7)) === i + 1) })).filter((g) => g.items.length > 0);
  const habiles = delAnio.filter((f) => new Date(`${f.fecha.slice(0, 10)}T00:00:00Z`).getUTCDay() !== 0).length;

  async function crear(fecha: string, nombre: string) {
    const r = await fetchWithSupabaseSession("/api/rrhh/feriados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fecha, nombre }),
    });
    const j = await r.json();
    return j.success ? null : (j.error ?? "Error");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fecha || !form.nombre.trim()) { avisar(false, "Fecha y nombre."); return; }
    setGuardando(true);
    const err = await crear(form.fecha, form.nombre.trim());
    setGuardando(false);
    if (err) { avisar(false, err); return; }
    avisar(true, "Feriado agregado.");
    setForm({ fecha: "", nombre: "" });
    setAbierto(false);
    await recargar();
  }

  /** Los de fecha fija y la Semana Santa, que el sistema ya sabe calcular. */
  async function cargarNacionales() {
    setCargandoNac(true);
    const pascua = feriadosFijosPy(anio);
    let ok = 0;
    for (const f of faltanNacionales) {
      const k = f.slice(5);
      const nombre = NOMBRES_FIJOS[k] ?? (f === pascua[7] ? "Jueves Santo" : f === pascua[8] ? "Viernes Santo" : "Feriado nacional");
      if (!(await crear(f, nombre))) ok++;
    }
    setCargandoNac(false);
    avisar(ok === faltanNacionales.length, `${ok} feriado${ok === 1 ? "" : "s"} nacional${ok === 1 ? "" : "es"} cargado${ok === 1 ? "" : "s"} para ${anio}.`);
    await recargar();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard compact label={`Feriados ${anio}`} value={delAnio.length} icon={<Flag className="h-4 w-4" />} accent
          hint={`${habiles} caen en día hábil`} />
        <StatCard compact label="Próximo feriado" value={proximo ? fmtFecha(proximo.fecha) : "—"} icon={<CalendarDays className="h-4 w-4" />}
          hint={proximo ? `${diaSemana(proximo.fecha)} · ${proximo.nombre}` : "ninguno cargado"} />
        <StatCard compact label="Nacionales sin cargar" value={faltanNacionales.length} icon={<CalendarOff className="h-4 w-4" />}
          hint={faltanNacionales.length ? "de fecha fija y Semana Santa" : `${anio} completo`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white">
          <button type="button" onClick={() => setAnio(anio - 1)} className="px-2 py-2 text-slate-500 hover:text-slate-800" aria-label="Año anterior"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[56px] text-center text-sm font-semibold text-slate-800">{anio}</span>
          <button type="button" onClick={() => setAnio(anio + 1)} className="px-2 py-2 text-slate-500 hover:text-slate-800" aria-label="Año siguiente"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {faltanNacionales.length > 0 && (
          <button type="button" onClick={cargarNacionales} disabled={cargandoNac}
            className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 px-3 py-2 text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/10 disabled:opacity-50">
            {cargandoNac ? "Cargando…" : `Cargar los ${faltanNacionales.length} nacionales de ${anio}`}
          </button>
        )}
        {!abierto && (
          <button type="button" onClick={() => setAbierto(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
            <Plus className="h-4 w-4" /> Agregar feriado
          </button>
        )}
      </div>

      {abierto && (
        <form onSubmit={guardar} className="flex flex-wrap items-end gap-3 rounded-xl border border-[#4FAEB2]/30 bg-white p-5">
          <div>
            <label className={lblCls}>Fecha</label>
            <input type="date" className={inputCls} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          </div>
          <div className="min-w-[240px] flex-1">
            <label className={lblCls}>Nombre</label>
            <input className={inputCls} value={form.nombre} placeholder="Ej. Día de los Héroes (trasladado)" onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </div>
          <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button type="submit" disabled={guardando} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando ? "Guardando…" : "Agregar"}
          </button>
          <p className="w-full text-xs text-slate-400">
            El 1 de marzo, el 12 de junio y el 29 de septiembre el gobierno suele trasladarlos por decreto: cargalos con el día que realmente no se trabaja.
          </p>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : porMes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
          <Flag className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">No hay feriados cargados para {anio}.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {porMes.map((g) => (
            <section key={g.mes} className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.mes}</h3>
              <ul className="divide-y divide-slate-100">
                {g.items.map((f) => {
                  const pasado = f.fecha < hoy;
                  const domingo = new Date(`${f.fecha.slice(0, 10)}T00:00:00Z`).getUTCDay() === 0;
                  return (
                    <li key={f.id} className={`group flex items-center gap-3 py-2 ${pasado ? "opacity-50" : ""}`}>
                      <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]">
                        <span className="text-sm font-bold leading-none">{Number(f.fecha.slice(8, 10))}</span>
                        <span className="text-[9px] uppercase">{diaSemana(f.fecha).slice(0, 3)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{f.nombre}</span>
                        {domingo && <span className="block text-[11px] text-slate-400">cae domingo</span>}
                      </span>
                      <button onClick={() => onBorrar(f)} title="Eliminar"
                        className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
