"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export const dynamic = "force-dynamic";

type Empleado = { id: string; nombre: string; cargo: string | null };
type Fichaje = {
  id: string;
  empleado_id: string;
  empleado_nombre: string | null;
  empleado_cargo: string | null;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  horas: number;
  observacion: string | null;
  entrada_lat: number | null;
  entrada_lng: number | null;
  salida_lat: number | null;
  salida_lng: number | null;
  marcado_kiosco: boolean | null;
};

function fmtFecha(iso: string): string {
  try { return new Date(iso).toLocaleDateString("es-PY"); } catch { return iso.slice(0, 10); }
}

export default function ControlHorarioPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [fichajes, setFichajes] = useState<Fichaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    empleado_id: "",
    fecha: new Date().toISOString().slice(0, 10),
    hora_entrada: "08:00",
    hora_salida: "17:00",
    observacion: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rE, rF] = await Promise.all([
        fetchWithSupabaseSession("/api/rrhh/empleados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/rrhh/fichajes", { cache: "no-store" }),
      ]);
      const jE = (await rE.json().catch(() => ({}))) as { success?: boolean; data?: { empleados?: Empleado[] } };
      const jF = (await rF.json().catch(() => ({}))) as { success?: boolean; data?: { fichajes?: Fichaje[] }; error?: string };
      if (rE.ok && jE.success) setEmpleados(jE.data?.empleados ?? []);
      if (rF.ok && jF.success) { setFichajes(jF.data?.fichajes ?? []); setErr(null); }
      else setErr(jF.error ?? "No se pudieron cargar los fichajes");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.empleado_id) return;
    setSaving(true);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/fichajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (r.ok && j.success) {
        setForm({ ...form, empleado_id: "", observacion: "" });
        await load();
      } else {
        setErr(j.error ?? "No se pudo guardar el fichaje");
      }
    } finally { setSaving(false); }
  }

  const totalHoras = fichajes.reduce((acc, f) => acc + Number(f.horas), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · RRHH"
        title="Control horario"
        description="Registro de entrada y salida diaria. Las horas se calculan automáticamente."
        backHref="/rrhh"
        backLabel="RRHH"
      />

      {err && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      <KioscoLinkCard />

      <ReporteMarcacionesCard empleados={empleados} />

      {empleados.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Cargá primero empleados desde <a href="/rrhh/empleados" className="font-medium text-[#3F8E91] underline">RRHH → Empleados</a>.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700">Registrar fichaje</h3>
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
              <label className={lblCls}>Fecha</label>
              <input type="date" className={inputCls} value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <div>
              <label className={lblCls}>Entrada</label>
              <input type="time" className={inputCls} value={form.hora_entrada}
                onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })} />
            </div>
            <div>
              <label className={lblCls}>Salida</label>
              <input type="time" className={inputCls} value={form.hora_salida}
                onChange={(e) => setForm({ ...form, hora_salida: e.target.value })} />
            </div>
          </div>
          <div className="mt-3">
            <label className={lblCls}>Observación</label>
            <input className={inputCls} value={form.observacion}
              placeholder="Ej. ½ jornada, turno noche"
              onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Si ya existe un fichaje del empleado para esa fecha, se actualiza (no duplica).
          </p>
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar fichaje"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Últimos 30 días</h3>
          <span className="text-xs text-slate-500">Total horas registradas: <strong className="tabular-nums text-slate-800">{totalHoras.toFixed(1)}</strong></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Empleado</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Cargo</th>
                <th className="px-4 py-3 font-semibold">Entrada</th>
                <th className="px-4 py-3 font-semibold">Salida</th>
                <th className="px-4 py-3 font-semibold text-right">Horas</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Ubicación</th>
                <th className="px-4 py-3 font-semibold hidden lg:table-cell">Obs.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : fichajes.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">Sin fichajes registrados</td></tr>
              ) : (
                fichajes.map((f) => (
                  <tr key={f.id} className="hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-4 py-2.5 text-gray-600 text-xs tabular-nums">{fmtFecha(f.fecha)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{f.empleado_nombre ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{f.empleado_cargo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums">{f.hora_entrada ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums">{f.hora_salida ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{Number(f.horas).toFixed(1)}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell"><UbicacionFichaje f={f} /></td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden lg:table-cell">{f.observacion ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#4FAEB2]/50 focus:ring-2 focus:ring-[#4FAEB2]/30";
const lblCls = "block text-xs font-medium text-slate-600 mb-1";

/**
 * Muestra hasta dos pines (entrada/salida) con link a Google Maps. Solo se
 * llena cuando el empleado fichó desde el kiosco y autorizó geolocalización;
 * en fichajes cargados a mano queda en "—".
 */
function UbicacionFichaje({ f }: { f: Fichaje }) {
  const entrada = f.entrada_lat != null && f.entrada_lng != null
    ? { lat: f.entrada_lat, lng: f.entrada_lng } : null;
  const salida = f.salida_lat != null && f.salida_lng != null
    ? { lat: f.salida_lat, lng: f.salida_lng } : null;
  if (!entrada && !salida) return <span className="text-xs text-slate-300">—</span>;
  const link = (lat: number, lng: number) =>
    `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {entrada && (
        <a href={link(entrada.lat, entrada.lng)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
          title={`Entrada: ${entrada.lat.toFixed(5)}, ${entrada.lng.toFixed(5)}`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
          </svg>
          Entrada
        </a>
      )}
      {salida && (
        <a href={link(salida.lat, salida.lng)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-rose-700 hover:underline"
          title={`Salida: ${salida.lat.toFixed(5)}, ${salida.lng.toFixed(5)}`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
          </svg>
          Salida
        </a>
      )}
    </div>
  );
}

/**
 * Caja con el link público del kiosco de fichaje. Mostrar el link entero
 * facilita compartirlo por WhatsApp o pegarlo en un cartel; "Regenerar" lo
 * rota si se filtró.
 */
function KioscoLinkCard() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/fichar-token", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { token: string | null }; error?: string };
      if (r.ok && j.success) { setToken(j.data?.token ?? null); setErr(null); }
      else setErr(j.error ?? "No se pudo cargar el link");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function regenerar() {
    setBusy(true);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/fichar-token", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { token: string }; error?: string };
      if (r.ok && j.success) { setToken(j.data?.token ?? null); setErr(null); setConfirmar(false); }
      else setErr(j.error ?? "No se pudo generar el token");
    } finally { setBusy(false); }
  }

  // El link "corto" /fichar (sin token) resuelve la empresa solo y, si no
  // hay token activo, lo genera en el momento. Es el que recomendamos para
  // compartir; el token largo solo se muestra si se quiere blindar la URL.
  const urlCorto = typeof window !== "undefined" ? `${window.location.origin}/fichar` : null;
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/fichar/${token}` : null;

  async function copiar(texto: string | null) {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      setErr("No se pudo copiar al portapapeles");
    }
  }

  return (
    <section className="rounded-xl border border-[#4FAEB2]/30 bg-[#E5F4F4]/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2] text-white">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Link público de fichaje</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Compartilo con los empleados. Marcan su entrada/salida tipeando su DNI; no necesitan login.
          </p>
          {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}

          {loading ? (
            <p className="mt-3 text-xs text-slate-500">Cargando…</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Link para compartir</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    readOnly
                    value={urlCorto ?? ""}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs tabular-nums text-slate-700"
                    onFocus={(e) => e.target.select()}
                  />
                  <button type="button" onClick={() => void copiar(urlCorto)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    {copiado ? "✓ Copiado" : "Copiar"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Funciona sin generar nada: al abrirlo, resuelve la empresa solo. Compartilo con los empleados.
                </p>
                {urlCorto && (
                  <a href={urlCorto} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    Abrir en otra pestaña ↗
                  </a>
                )}
              </div>

              <details className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
                  Opciones avanzadas (link blindado por token)
                </summary>
                <div className="space-y-2 border-t border-slate-100 px-3 py-3">
                  {!token ? (
                    <p className="text-xs text-slate-600">Aún no hay un token blindado. El link corto de arriba ya funciona; este es solo si querés una URL que se pueda revocar puntualmente.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={url ?? ""}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs tabular-nums text-slate-700"
                        onFocus={(e) => e.target.select()}
                      />
                      <button type="button" onClick={() => void copiar(url)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                        Copiar
                      </button>
                    </div>
                  )}
                  <button type="button" onClick={() => setConfirmar(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">
                    {token ? "Regenerar token (invalida el anterior)" : "Generar token"}
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>

      {confirmar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !busy && setConfirmar(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-slate-900">Regenerar link</h4>
            <p className="mt-2 text-xs text-slate-600">
              El link anterior dejará de funcionar inmediatamente. ¿Continuar?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmar(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs">Cancelar</button>
              <button type="button" disabled={busy} onClick={() => void regenerar()}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                {busy ? "Generando…" : "Sí, regenerar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Reporte PDF de marcaciones — Fase F.
 * Filtro opcional por empleado + rango de fechas (por defecto último mes).
 */
function ReporteMarcacionesCard({ empleados }: { empleados: Empleado[] }) {
  const hoy = new Date();
  const mesAtras = new Date(hoy); mesAtras.setDate(hoy.getDate() - 30);
  const [empleadoId, setEmpleadoId] = useState<string>("");
  const [desde, setDesde] = useState<string>(mesAtras.toISOString().slice(0, 10));
  const [hasta, setHasta] = useState<string>(hoy.toISOString().slice(0, 10));

  const url = (() => {
    const p = new URLSearchParams();
    if (empleadoId) p.set("empleadoId", empleadoId);
    p.set("desde", desde);
    p.set("hasta", hasta);
    return `/api/rrhh/fichajes/reporte-pdf?${p.toString()}`;
  })();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Reporte PDF de marcaciones</h3>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600">Empleado (opcional)</label>
          <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-3">
        <a href={url} target="_blank" rel="noreferrer"
          className="inline-flex items-center rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F9EA2]">
          📄 Descargar PDF
        </a>
      </div>
    </div>
  );
}
