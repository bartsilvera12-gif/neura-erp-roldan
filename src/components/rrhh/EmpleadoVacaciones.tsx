"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatFecha as fmtFecha } from "@/lib/fecha/asuncion";
import { AlertTriangle, FileSignature, Palmtree, Plus, X } from "lucide-react";

/**
 * Vacaciones del empleado, dentro de su ficha: saldo según la ley, registrar
 * nuevas, imprimir la comunicación para firmar y el historial. Usa las mismas
 * APIs que la pantalla de Vacaciones, así que los números son los mismos.
 */

type Saldo = {
  empleado_id: string;
  anios: number;
  antiguedad: string | null;
  dias_por_anio: number;
  dias_generados: number;
  dias_usados: number;
  dias_disponibles: number;
  vigente_desde: string | null;
  proximo_derecho_fecha: string | null;
  proximo_derecho_dias: number;
};
type Registro = {
  id: string;
  fecha_desde: string;
  fecha_hasta: string;
  dias: number;
  tipo_ausencia: string | null;
  estado: "pendiente" | "aprobada" | "rechazada" | "cancelada";
  observacion: string | null;
};

const hoyPy = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function EmpleadoVacaciones({ empleadoId }: { empleadoId: string }) {
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({ desde: hoyPy(), hasta: hoyPy(), observacion: "" });
  const [dias, setDias] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; constancia?: string } | null>(null);

  const cargar = useCallback(async () => {
    const [rS, rV] = await Promise.all([
      fetchWithSupabaseSession("/api/rrhh/vacaciones/saldos", { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/rrhh/vacaciones?empleadoId=${encodeURIComponent(empleadoId)}`, { cache: "no-store" }),
    ]);
    const jS = await rS.json().catch(() => ({}));
    const jV = await rV.json().catch(() => ({}));
    setSaldo(((jS?.data?.saldos ?? []) as Saldo[]).find((s) => s.empleado_id === empleadoId) ?? null);
    setRegistros(((jV?.data?.solicitudes ?? []) as Registro[]).filter((r) => (r.tipo_ausencia ?? "vacaciones") === "vacaciones"));
  }, [empleadoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Días hábiles que ocupa, contados igual que al guardar.
  useEffect(() => {
    if (!abierto || !form.desde || !form.hasta) return;
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ desde: form.desde, hasta: form.hasta, tipo: "vacaciones" });
    fetchWithSupabaseSession(`/api/rrhh/vacaciones/preview-dias?${qs}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => setDias(Number(j?.data?.dias ?? 0)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [abierto, form.desde, form.hasta]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setMsg(null);
    try {
      const r = await fetchWithSupabaseSession("/api/rrhh/vacaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleado_id: empleadoId, tipo_ausencia: "vacaciones", fecha_desde: form.desde, fecha_hasta: form.hasta,
          observacion: form.observacion, origen: "empleado", modo: "admin",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setMsg({ ok: false, texto: j?.error ?? "No se pudo registrar" }); return; }
      const id = j?.data?.solicitud?.id as string | undefined;
      setMsg({ ok: true, texto: `Registradas: ${j?.data?.dias_calculados ?? ""} días hábiles.`, constancia: id ? `/api/rrhh/vacaciones/${id}/constancia` : undefined });
      setForm({ desde: hoyPy(), hasta: hoyPy(), observacion: "" });
      setAbierto(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function cancelar(id: string) {
    if (!window.confirm("¿Cancelar estas vacaciones? Los días vuelven al saldo.")) return;
    const r = await fetchWithSupabaseSession(`/api/rrhh/vacaciones/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "cancelada" }),
    });
    if (r.ok) await cargar();
  }

  const excede = saldo && dias != null && dias > saldo.dias_disponibles;
  const hoy = hoyPy();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#3F8E91]"><Palmtree className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Vacaciones</h2>
            <p className="mt-0.5 text-xs text-slate-500">Según la ley: 12, 18 o 30 días hábiles por año trabajado, de lunes a sábado.</p>
          </div>
        </div>
        {!abierto && (
          <button type="button" onClick={() => { setAbierto(true); setMsg(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
            <Plus className="h-4 w-4" /> Registrar vacaciones
          </button>
        )}
      </div>

      {/* Saldo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dato titulo="Disponibles" valor={saldo ? String(saldo.dias_disponibles) : "—"} destacado={saldo ? saldo.dias_disponibles >= 0 : false}
          alerta={!!saldo && saldo.dias_disponibles < 0} pie={saldo && saldo.dias_disponibles < 0 ? "días adelantados" : "días hábiles"} />
        <Dato titulo="Le corresponden por año" valor={saldo ? String(saldo.dias_por_anio) : "—"} pie={saldo?.antiguedad ? `${saldo.antiguedad} de antigüedad` : "sin fecha de ingreso"} />
        <Dato titulo="Tomados (período vigente)" valor={saldo ? String(saldo.dias_usados) : "—"}
          pie={saldo?.vigente_desde ? `desde ${fmtFecha(saldo.vigente_desde)}` : "todavía sin período cumplido"} />
        <Dato titulo="Próximo derecho" valor={saldo?.proximo_derecho_fecha ? fmtFecha(saldo.proximo_derecho_fecha) : "—"}
          pie={saldo ? `+${saldo.proximo_derecho_dias} días` : ""} />
      </div>

      {msg && (
        <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span>{msg.texto}</span>
          {msg.constancia && (
            <a href={msg.constancia} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
              <FileSignature className="h-3.5 w-3.5" /> Imprimir la comunicación para firmar
            </a>
          )}
        </div>
      )}

      {abierto && (
        <form onSubmit={registrar} className="mt-4 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.03] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Registrar vacaciones</h3>
            <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Desde</label>
              <input type="date" className={inputCls} value={form.desde}
                onChange={(e) => setForm({ ...form, desde: e.target.value, hasta: e.target.value > form.hasta ? e.target.value : form.hasta })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Hasta (último día)</label>
              <input type="date" className={inputCls} value={form.hasta} min={form.desde} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Observación</label>
              <input className={inputCls} value={form.observacion} placeholder="Ej. período 2025-2026" onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              {dias != null && <><b className="text-lg text-slate-900">{dias}</b> días hábiles <span className="text-xs text-slate-400">(lunes a sábado, sin domingos ni feriados)</span></>}
              {excede && saldo && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {saldo.anios === 0 ? "Todavía no cumplió su primer año." : `Tiene ${Math.max(0, saldo.dias_disponibles)} disponibles.`} Solo se puede si la política permite adelantar.
                </p>
              )}
            </div>
            <button type="submit" disabled={guardando || !dias}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50">
              {guardando ? "Guardando…" : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {/* Historial */}
      <div className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</h3>
        {registros.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">Todavía no tiene vacaciones registradas.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {registros.map((r) => {
              const enCurso = r.estado === "aprobada" && r.fecha_desde <= hoy && r.fecha_hasta >= hoy;
              const anulada = r.estado === "cancelada" || r.estado === "rechazada";
              return (
                <li key={r.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm ${anulada ? "opacity-50" : ""}`}>
                  <span className="tabular-nums text-slate-700">{fmtFecha(r.fecha_desde)} → {fmtFecha(r.fecha_hasta)}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{r.dias} días</span>
                  {enCurso && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">de vacaciones</span>}
                  {anulada && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{r.estado}</span>}
                  {r.observacion && <span className="truncate text-xs text-slate-400">{r.observacion}</span>}
                  {!anulada && (
                    <span className="ml-auto flex items-center gap-3">
                      <a href={`/api/rrhh/vacaciones/${r.id}/constancia`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#3F8E91] hover:underline">
                        <FileSignature className="h-3.5 w-3.5" /> comunicación
                      </a>
                      {r.fecha_desde > hoy && (
                        <button type="button" onClick={() => void cancelar(r.id)} className="text-xs text-rose-600 hover:underline">cancelar</button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Dato({ titulo, valor, pie, destacado = false, alerta = false }: { titulo: string; valor: string; pie?: string; destacado?: boolean; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destacado ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/5" : alerta ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
      <p className="text-[11px] font-medium text-slate-500">{titulo}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${alerta ? "text-amber-700" : destacado ? "text-[#3F8E91]" : "text-slate-800"}`}>{valor}</p>
      {pie && <p className="text-[11px] text-slate-400">{pie}</p>}
    </div>
  );
}
