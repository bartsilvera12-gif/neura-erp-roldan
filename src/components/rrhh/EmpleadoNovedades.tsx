"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatFecha as fmtFecha } from "@/lib/fecha/asuncion";
import { TIPOS_NOVEDAD, tipoNovedad, type Novedad, type TipoNovedad } from "@/lib/rrhh/novedades";
import { AlertTriangle, Check, ClipboardList, FileSignature, Plus, X } from "lucide-react";

/**
 * Amonestaciones, observaciones y reconocimientos, dentro de la ficha.
 *
 * Arriba un resumen (cuántas de cada una en los últimos 12 meses), el botón
 * para registrar, y abajo la línea de tiempo. Lo que se firma tiene su hoja
 * para imprimir y se marca "firmada" cuando vuelve con la firma.
 */

const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

const TONO: Record<string, { chip: string; punto: string; on: string }> = {
  slate: { chip: "bg-slate-100 text-slate-700", punto: "bg-slate-400", on: "border-slate-400 bg-slate-50 ring-slate-400" },
  amber: { chip: "bg-amber-50 text-amber-800", punto: "bg-amber-500", on: "border-amber-500 bg-amber-50 ring-amber-500" },
  rose: { chip: "bg-rose-50 text-rose-700", punto: "bg-rose-500", on: "border-rose-500 bg-rose-50 ring-rose-500" },
  red: { chip: "bg-red-100 text-red-800", punto: "bg-red-600", on: "border-red-600 bg-red-50 ring-red-600" },
  emerald: { chip: "bg-emerald-50 text-emerald-700", punto: "bg-emerald-500", on: "border-emerald-500 bg-emerald-50 ring-emerald-500" },
};

const inputCls =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function EmpleadoNovedades({ empleadoId }: { empleadoId: string }) {
  const [items, setItems] = useState<Novedad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [faltaScript, setFaltaScript] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<TipoNovedad | "todas">("todas");
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; hoja?: string } | null>(null);
  const [form, setForm] = useState({
    tipo: "amonestacion" as TipoNovedad, fecha: hoyPy(), motivo: "", detalle: "",
    dias_suspension: "1", suspension_desde: "",
  });

  const cargar = useCallback(async () => {
    const r = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/novedades`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setItems((j?.data?.novedades ?? []) as Novedad[]);
    setFaltaScript(j?.data?.falta_script ?? (!r.ok ? (j?.error ?? "No se pudieron cargar.") : null));
    setCargando(false);
  }, [empleadoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const haceUnAnio = useMemo(() => {
    const d = new Date(`${hoyPy()}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const vigentes = items.filter((n) => n.estado === "vigente");
  const ultimoAnio = vigentes.filter((n) => n.fecha >= haceUnAnio);
  const cuenta = (t: TipoNovedad) => ultimoAnio.filter((n) => n.tipo === t).length;
  const visibles = items.filter((n) => (verAnuladas || n.estado === "vigente") && (filtro === "todas" || n.tipo === filtro));
  const anuladas = items.length - vigentes.length;

  async function registrar(ev: React.FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/novedades`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          dias_suspension: form.tipo === "suspension" ? Number(form.dias_suspension) : null,
          suspension_desde: form.tipo === "suspension" ? form.suspension_desde || null : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setMsg({ ok: false, texto: j?.error ?? "No se pudo registrar." }); return; }
      const nuevo = j.data?.novedad as Novedad | undefined;
      const t = tipoNovedad(form.tipo);
      setMsg({
        ok: true,
        texto: `${t.label} registrada.`,
        hoja: nuevo && t.seFirma ? `/api/rrhh/novedades/${nuevo.id}/hoja` : undefined,
      });
      setForm({ tipo: form.tipo, fecha: hoyPy(), motivo: "", detalle: "", dias_suspension: "1", suspension_desde: "" });
      setAbierto(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function cambiar(id: string, body: Record<string, unknown>) {
    const r = await fetchWithSupabaseSession(`/api/rrhh/novedades/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) setMsg({ ok: false, texto: j?.error ?? "No se pudo guardar." });
    await cargar();
  }

  function anular(n: Novedad) {
    const motivo = window.prompt(`¿Por qué se anula esta ${tipoNovedad(n.tipo).label.toLowerCase()}? Queda en el historial como anulada.`);
    if (motivo && motivo.trim()) void cambiar(n.id, { anular: true, motivo: motivo.trim() });
  }

  const tipoSel = tipoNovedad(form.tipo);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]">
              <ClipboardList className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Amonestaciones y observaciones</h2>
              <p className="text-xs text-slate-500">Llamadas de atención, amonestaciones, suspensiones, notas y reconocimientos.</p>
            </div>
          </div>
          {!faltaScript && (
            <button type="button" onClick={() => { setAbierto((v) => !v); setMsg(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
              <Plus className="h-4 w-4" /> Registrar
            </button>
          )}
        </div>

        {/* Resumen de los últimos 12 meses */}
        {!faltaScript && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TIPOS_NOVEDAD.map((t) => {
              const n = cuenta(t.v);
              return (
                <button key={t.v} type="button" onClick={() => setFiltro(filtro === t.v ? "todas" : t.v)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    filtro === t.v ? "border-[#4FAEB2] ring-1 ring-[#4FAEB2]" : "border-slate-200 hover:border-slate-300"
                  }`}>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${TONO[t.tono].punto}`} /> {t.label}
                  </span>
                  <span className={`text-xl font-semibold tabular-nums ${n ? "text-slate-900" : "text-slate-300"}`}>{n}</span>
                </button>
              );
            })}
          </div>
        )}
        {!faltaScript && <p className="mt-1.5 text-[11px] text-slate-400">Últimos 12 meses. Tocá un tipo para filtrar.</p>}

        {faltaScript && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {faltaScript}
          </p>
        )}

        {msg && (
          <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <span>{msg.texto}</span>
            {msg.hoja && (
              <a href={msg.hoja} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
                <FileSignature className="h-3.5 w-3.5" /> Imprimir para firmar
              </a>
            )}
          </div>
        )}

        {abierto && (
          <form onSubmit={registrar} className="mt-4 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.03] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Registrar</h3>
              <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {TIPOS_NOVEDAD.map((t) => {
                const on = form.tipo === t.v;
                return (
                  <button key={t.v} type="button" onClick={() => setForm({ ...form, tipo: t.v })} aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on ? `${TONO[t.tono].on} ring-1 text-slate-900` : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}>
                    <span className={`h-2 w-2 rounded-full ${TONO[t.tono].punto}`} /> {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">{tipoSel.ayuda}</p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
              <label className="text-xs font-medium text-slate-600">
                Fecha
                <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={inputCls} />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Motivo *
                <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} maxLength={300} required
                  placeholder={form.tipo === "reconocimiento" ? "Ej: Cumplimiento de metas del mes" : "Ej: Llegadas tarde reiteradas"}
                  className={inputCls} />
              </label>
            </div>

            {form.tipo === "suspension" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[160px_160px_1fr]">
                <label className="text-xs font-medium text-slate-600">
                  Días de suspensión
                  <input type="number" min={1} max={30} value={form.dias_suspension}
                    onChange={(e) => setForm({ ...form, dias_suspension: e.target.value })} className={`${inputCls} tabular-nums`} />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Desde
                  <input type="date" value={form.suspension_desde} onChange={(e) => setForm({ ...form, suspension_desde: e.target.value })} className={inputCls} />
                </label>
                {Number(form.dias_suspension) > 8 && (
                  <p className="self-end pb-2 text-xs text-amber-700">Una suspensión disciplinaria normalmente no pasa de 8 días.</p>
                )}
              </div>
            )}

            <label className="mt-3 block text-xs font-medium text-slate-600">
              Detalle <span className="font-normal text-slate-400">(qué pasó, testigos, antecedentes)</span>
              <textarea value={form.detalle} onChange={(e) => setForm({ ...form, detalle: e.target.value })} rows={3} maxLength={4000}
                className={inputCls} />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
              <button type="submit" disabled={guardando || !form.motivo.trim()}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {guardando ? "Guardando…" : `Registrar ${tipoSel.label.toLowerCase()}`}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Historial */}
      {!faltaScript && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Historial{filtro !== "todas" && <span className="font-normal text-slate-500"> · {tipoNovedad(filtro).label}</span>}
            </h3>
            <div className="flex items-center gap-3 text-xs">
              {filtro !== "todas" && (
                <button type="button" onClick={() => setFiltro("todas")} className="font-medium text-[#3F8E91] hover:underline">Ver todas</button>
              )}
              {anuladas > 0 && (
                <label className="flex items-center gap-1.5 text-slate-500">
                  <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} className="accent-[#4FAEB2]" />
                  Mostrar anuladas ({anuladas})
                </label>
              )}
            </div>
          </div>

          {cargando ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : visibles.length === 0 ? (
            <div className="py-12 text-center">
              <ClipboardList className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                {items.length === 0 ? "Sin amonestaciones ni observaciones registradas." : "Nada con este filtro."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibles.map((n) => {
                const t = tipoNovedad(n.tipo);
                const anulada = n.estado === "anulada";
                return (
                  <li key={n.id} className={`flex gap-4 px-5 py-4 ${anulada ? "opacity-60" : ""}`}>
                    <div className="w-20 shrink-0 text-xs tabular-nums text-slate-500">{fmtFecha(n.fecha)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO[t.tono].chip}`}>{t.label}</span>
                        {n.tipo === "suspension" && n.dias_suspension && (
                          <span className="text-xs text-slate-600">
                            {n.dias_suspension} {n.dias_suspension === 1 ? "día" : "días"}
                            {n.suspension_desde ? ` desde ${fmtFecha(n.suspension_desde)}` : ""}
                          </span>
                        )}
                        {anulada ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Anulada</span>
                        ) : t.seFirma ? (
                          n.firmada_at ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> Firmada</span>
                          ) : (
                            <span className="text-[11px] font-medium text-amber-700">Falta la firma</span>
                          )
                        ) : null}
                      </div>
                      <p className={`mt-1 text-sm font-medium text-slate-900 ${anulada ? "line-through" : ""}`}>{n.motivo}</p>
                      {n.detalle && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{n.detalle}</p>}
                      {anulada && n.motivo_anulacion && (
                        <p className="mt-1 text-xs text-slate-500">Anulada: {n.motivo_anulacion}</p>
                      )}
                      {n.created_by_nombre && <p className="mt-1 text-[11px] text-slate-400">Cargó {n.created_by_nombre}</p>}
                    </div>
                    {!anulada && (
                      <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs">
                        {t.seFirma && (
                          <>
                            <a href={`/api/rrhh/novedades/${n.id}/hoja`} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#3F8E91] hover:underline">
                              <FileSignature className="h-3.5 w-3.5" /> Imprimir
                            </a>
                            <button type="button" onClick={() => void cambiar(n.id, { firmada: !n.firmada_at })}
                              className="text-slate-500 hover:text-slate-800">
                              {n.firmada_at ? "Desmarcar firma" : "Marcar firmada"}
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => anular(n)} className="text-slate-400 hover:text-rose-600">Anular</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
