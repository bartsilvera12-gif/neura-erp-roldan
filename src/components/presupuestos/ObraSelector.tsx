"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type ObraLite = { id: string; nombre: string; direccion: string | null; ciudad: string | null; cliente_id: string | null };

/**
 * La obra del presupuesto: se busca y se elige, o se crea ahí mismo.
 *
 * No se escribe en un campo libre a propósito (pedido del cliente): la misma
 * obra escrita a mano quedaba con tres nombres distintos y no se encontraba
 * después al buscar.
 */
export default function ObraSelector({
  value,
  onChange,
  clienteId,
  inicial,
  inputClass,
  labelClass,
}: {
  value: string;
  onChange: (obra: ObraLite | null) => void;
  /** El cliente del presupuesto: sus obras salen primero y la nueva queda a su nombre. */
  clienteId?: string | null;
  /** La obra ya guardada, para mostrar su nombre sin buscarla. */
  inicial?: ObraLite | null;
  inputClass: string;
  labelClass: string;
}) {
  const [obras, setObras] = useState<ObraLite[]>(inicial ? [inicial] : []);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: "", direccion: "", ciudad: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    if (inicial && !obras.some((o) => o.id === inicial.id)) setObras((prev) => [inicial, ...prev]);
  }, [inicial, obras]);

  const buscar = useCallback(async (texto: string) => {
    const nro = ++pedido.current;
    setBuscando(true);
    try {
      const qs = new URLSearchParams();
      if (texto.trim()) qs.set("q", texto.trim());
      if (clienteId) qs.set("cliente_id", clienteId);
      const r = await fetchWithSupabaseSession(`/api/obras?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (nro !== pedido.current) return;
      setAviso(j?.data?.aviso ?? null);
      const encontradas = (j?.data?.obras ?? []) as ObraLite[];
      setObras((prev) => {
        const elegida = prev.find((o) => o.id === value);
        return elegida && !encontradas.some((o) => o.id === elegida.id) ? [elegida, ...encontradas] : encontradas;
      });
    } finally {
      if (nro === pedido.current) setBuscando(false);
    }
  }, [clienteId, value]);

  // Al elegir cliente, se traen sus obras para tenerlas a mano.
  useEffect(() => { void buscar(""); }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    if (!nueva.nombre.trim()) { setError("Poné el nombre de la obra."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/obras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...nueva, cliente_id: clienteId || null }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo crear la obra."); return; }
      const obra = j.data.obra as ObraLite;
      setObras((prev) => [obra, ...prev.filter((o) => o.id !== obra.id)]);
      onChange(obra);
      setCreando(false);
      setNueva({ nombre: "", direccion: "", ciudad: "" });
    } catch {
      setError("Error de red al crear la obra.");
    } finally {
      setGuardando(false);
    }
  }

  const elegida = obras.find((o) => o.id === value) ?? null;

  return (
    <div>
      <label className={labelClass}>Obra (dirección de entrega)</label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[240px] flex-1">
          <SearchableSelect
            value={value || null}
            onChange={(id) => onChange(obras.find((o) => o.id === id) ?? null)}
            onSearch={buscar}
            loading={buscando}
            placeholder="— Sin obra —"
            emptyText="No hay obras con ese nombre o dirección"
            options={obras.map((o) => ({
              id: o.id,
              label: o.nombre,
              hint: [o.direccion, o.ciudad].filter(Boolean).join(", ") || undefined,
            }))}
          />
        </div>
        {value && (
          <button type="button" onClick={() => onChange(null)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
            Quitar
          </button>
        )}
        <button type="button" onClick={() => { setCreando((v) => !v); setError(null); }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <Plus className="h-3.5 w-3.5" /> Nueva obra
        </button>
      </div>
      {elegida && (elegida.direccion || elegida.ciudad) && (
        <p className="mt-1 text-[11px] text-slate-500">
          Sale impresa: {[elegida.direccion, elegida.ciudad].filter(Boolean).join(", ")}
        </p>
      )}
      {aviso && <p className="mt-1 text-[11px] text-amber-700">{aviso}</p>}
      {creando && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
          <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
            placeholder="Nombre de la obra *" className={inputClass} />
          <input value={nueva.direccion} onChange={(e) => setNueva({ ...nueva, direccion: e.target.value })}
            placeholder="Dirección" className={inputClass} />
          <input value={nueva.ciudad} onChange={(e) => setNueva({ ...nueva, ciudad: e.target.value })}
            placeholder="Ciudad" className={inputClass} />
          <div className="flex items-center gap-2 sm:col-span-3">
            <button type="button" onClick={() => void crear()} disabled={guardando}
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {guardando ? "Creando…" : "Crear y elegir"}
            </button>
            <button type="button" onClick={() => setCreando(false)} className="text-xs text-slate-500 hover:underline">Cancelar</button>
            {error && <span className="text-xs text-rose-600">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
