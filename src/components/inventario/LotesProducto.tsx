"use client";

/**
 * Sección de "Lotes activos" en el detalle de un producto.
 * Lista los lotes vigentes (cantidad>0, activo=true) con badge de urgencia y
 * permite crear un lote manual (modal). Los lotes por compra se crean desde el
 * flujo de compra.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { diasRestantes, nivelPorDias, type NivelVencimiento } from "@/lib/lotes/nivel";

type Lote = {
  id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
  cantidad_original: number;
  fecha_ingreso: string | null;
  activo: boolean;
};

const badgeClasses: Record<NivelVencimiento, string> = {
  critico: "bg-red-100 text-red-700 border-red-200",
  proximo: "bg-amber-100 text-amber-700 border-amber-200",
  advertencia: "bg-yellow-50 text-yellow-700 border-yellow-200",
  ok: "bg-slate-100 text-slate-600 border-slate-200",
};

const badgeLabel: Record<NivelVencimiento, string> = {
  critico: "Crítico",
  proximo: "Próximo",
  advertencia: "Advertencia",
  ok: "OK",
};

export default function LotesProducto({ productoId }: { productoId: string }) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Edición inline por lote: id + valores editables.
  const [editId, setEditId] = useState<string | null>(null);
  const [editCantidad, setEditCantidad] = useState("");
  const [editVenc, setEditVenc] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [errorEdit, setErrorEdit] = useState<string | null>(null);

  function iniciarEdicion(l: Lote) {
    setEditId(l.id);
    setEditCantidad(String(l.cantidad));
    setEditVenc(l.fecha_vencimiento);
    setErrorEdit(null);
  }
  function cancelarEdicion() {
    setEditId(null); setEditCantidad(""); setEditVenc(""); setErrorEdit(null);
  }
  async function guardarEdicion(l: Lote) {
    setErrorEdit(null);
    const nueva = Number(editCantidad);
    if (!Number.isFinite(nueva) || nueva < 0) { setErrorEdit("Cantidad inválida."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editVenc)) { setErrorEdit("Fecha inválida."); return; }
    setGuardandoEdit(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/lotes/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad: nueva, fecha_vencimiento: editVenc }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) { setErrorEdit(j?.error ?? "No se pudo actualizar el lote."); return; }
      cancelarEdicion();
      await cargar();
    } catch (e) {
      setErrorEdit(e instanceof Error ? e.message : "Error de red.");
    } finally { setGuardandoEdit(false); }
  }
  async function borrar(l: Lote) {
    if (!window.confirm(`¿Eliminar el lote "${l.numero_lote}"? Se marca como inactivo, no se pierde el historial.`)) return;
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/lotes/${l.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j?.success) { alert(j?.error ?? "No se pudo eliminar."); return; }
      await cargar();
    } catch (e) { alert(e instanceof Error ? e.message : "Error de red."); }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/lotes`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudieron cargar los lotes.");
        setLotes([]);
      } else {
        setLotes((j.data?.lotes ?? []) as Lote[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
      setLotes([]);
    } finally {
      setCargando(false);
    }
  }, [productoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 max-w-5xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Lotes activos
        </h3>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
        >
          + Nuevo lote
        </button>
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500 animate-pulse">Cargando lotes…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : lotes.length === 0 ? (
        <p className="text-sm text-slate-500">
          No hay lotes activos. Al registrar una compra se creará automáticamente
          el lote correspondiente.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="py-2 px-3 font-medium">Nº lote</th>
                <th className="py-2 px-3 font-medium">Vencimiento</th>
                <th className="py-2 px-3 font-medium text-right">Cantidad</th>
                <th className="py-2 px-3 font-medium">Urgencia</th>
                <th className="py-2 px-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => {
                const dr = diasRestantes(l.fecha_vencimiento);
                const nivel = nivelPorDias(dr);
                const isEditing = editId === l.id;
                return (
                  <tr key={l.id} className={`border-t border-slate-100 ${isEditing ? "bg-amber-50/50" : ""}`}>
                    <td className="py-2 px-3 font-mono text-xs">{l.numero_lote}</td>
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editVenc}
                          onChange={(e) => setEditVenc(e.target.value)}
                          className="rounded border border-amber-300 bg-white px-2 py-1 text-sm"
                        />
                      ) : (
                        <>
                          {l.fecha_vencimiento}
                          <span className="ml-2 text-xs text-slate-400">
                            ({dr < 0 ? `vencido hace ${-dr} d` : `${dr} d`})
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editCantidad}
                          onChange={(e) => setEditCantidad(e.target.value)}
                          className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-right text-sm"
                          autoFocus
                        />
                      ) : (
                        l.cantidad
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClasses[nivel]}`}
                      >
                        {badgeLabel[nivel]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => guardarEdicion(l)}
                            disabled={guardandoEdit}
                            className="mr-2 text-xs font-medium text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50"
                          >
                            {guardandoEdit ? "…" : "Guardar"}
                          </button>
                          <button
                            onClick={cancelarEdicion}
                            disabled={guardandoEdit}
                            className="text-xs font-medium text-slate-500 hover:text-slate-800 underline"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => iniciarEdicion(l)}
                            className="mr-3 text-xs font-medium text-sky-700 hover:text-sky-900 underline"
                            title="Ajustar stock y vencimiento de este lote"
                          >
                            ✎ Editar
                          </button>
                          <button
                            onClick={() => borrar(l)}
                            className="text-xs font-medium text-rose-600 hover:text-rose-800 underline"
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {errorEdit && <p className="mt-2 text-xs text-red-600">{errorEdit}</p>}
        </div>
      )}

      {modalOpen && (
        <NuevoLoteModal
          productoId={productoId}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function NuevoLoteModal({
  productoId,
  onClose,
  onCreated,
}: {
  productoId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [numeroLote, setNumeroLote] = useState("");
  const [fechaVenc, setFechaVenc] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    if (!numeroLote.trim()) {
      setError("Ingresá el número de lote.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaVenc)) {
      setError("Fecha de vencimiento inválida.");
      return;
    }
    const c = Number(cantidad);
    if (!Number.isFinite(c) || c <= 0) {
      setError("Cantidad inválida.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/lotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_lote: numeroLote.trim(),
          fecha_vencimiento: fechaVenc,
          cantidad: c,
          observaciones: observaciones.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear el lote.");
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-3">
          <h4 className="text-base font-semibold text-slate-800">Nuevo lote</h4>
        </div>
        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nº de lote</label>
            <input
              type="text"
              value={numeroLote}
              onChange={(e) => setNumeroLote(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 outline-none"
              placeholder="Ej: LOTE-A123"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Fecha de vencimiento
            </label>
            <input
              type="date"
              value={fechaVenc}
              onChange={(e) => setFechaVenc(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cantidad</label>
            <input
              type="number"
              min={0}
              step="any"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 outline-none"
              placeholder="Ej: 50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Observaciones <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 outline-none"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="border border-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {enviando ? "Guardando…" : "Crear lote"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
