"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Catálogo de profesiones u oficios del cliente.
 *
 * Es una lista y no un campo de texto porque con texto libre terminan
 * conviviendo "ALBAÑIL", "Albanil" y "albañil " como si fueran tres oficios
 * distintos, y después no se puede filtrar ni contar nada por oficio — que es
 * justo para lo que sirve el dato acá.
 */
type Profesion = { id: string; nombre: string; orden: number; activa: boolean };

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function ProfesionesPage() {
  const [items, setItems] = useState<Profesion[]>([]);
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/profesiones", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setItems(j.data.profesiones ?? []);
      setAviso(typeof j.data.aviso === "string" ? j.data.aviso : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const n = nombre.trim();
    if (!n) return;
    setCreando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/profesiones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: n, orden: items.length }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setNombre("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setCreando(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/profesiones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      await cargar();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
      return false;
    }
  }

  async function eliminar(p: Profesion) {
    if (!window.confirm(`¿Borrar la profesión "${p.nombre}"?`)) return;
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/profesiones/${p.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar.");
    }
  }

  async function guardarEdicion(p: Profesion) {
    const n = editNombre.trim();
    if (!n) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    try {
      const ok = await patch(p.id, { nombre: n });
      if (ok) { setEditandoId(null); setEditNombre(""); }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Profesiones</h1>
        <p className="text-slate-600">
          Los oficios con los que se clasifica a los clientes (albañil, herrero, constructora…).
          Se eligen de esta lista en la ficha del cliente y en los presupuestos, para que el mismo
          oficio no termine escrito de cinco formas distintas.
        </p>
      </div>

      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{aviso}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={crear} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Nueva profesión</h2>
        <div className="flex flex-wrap gap-3">
          <input
            className={`${inputClass} max-w-sm flex-1`}
            placeholder="Ej. ALBAÑIL"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
          <button
            disabled={creando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-60"
          >
            {creando ? "Creando…" : "Agregar"}
          </button>
        </div>
        <p className="text-xs text-slate-500">Se guarda en mayúsculas, para que no entre dos veces la misma.</p>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Cargadas <span className="ml-1 text-xs font-normal text-slate-500">{items.length}</span>
          </h2>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">Todavía no hay profesiones cargadas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Nombre</th>
                <th className="w-32 px-4 py-2 text-left">Activa</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const editando = editandoId === p.id;
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${editando ? "bg-amber-50/60" : ""}`}>
                    <td className="px-4 py-2 font-medium">
                      {editando ? (
                        <input
                          autoFocus
                          value={editNombre}
                          onChange={(e) => setEditNombre(e.target.value)}
                          className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
                        />
                      ) : p.nombre}
                    </td>
                    <td className="px-4 py-2">
                      {/* Desactivar en vez de borrar: la profesión puede estar
                          escrita en fichas viejas y sacarla de la lista no
                          tiene por qué borrar esa historia. */}
                      <button
                        onClick={() => void patch(p.id, { activa: !p.activa })}
                        role="switch"
                        aria-checked={p.activa}
                        disabled={editando}
                        className={`inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${p.activa ? "bg-emerald-500" : "bg-slate-300"}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${p.activa ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                      <span className={`ml-2 text-xs font-medium ${p.activa ? "text-emerald-700" : "text-slate-500"}`}>
                        {p.activa ? "Sí" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editando ? (
                        <div className="inline-flex gap-3">
                          <button onClick={() => void guardarEdicion(p)} disabled={guardando}
                                  className="text-xs text-emerald-700 underline hover:text-emerald-900 disabled:opacity-50">
                            {guardando ? "Guardando…" : "Guardar"}
                          </button>
                          <button onClick={() => { setEditandoId(null); setEditNombre(""); }} disabled={guardando}
                                  className="text-xs text-slate-500 underline hover:text-slate-800">Cancelar</button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-3">
                          <button onClick={() => { setEditandoId(p.id); setEditNombre(p.nombre); setError(null); }}
                                  className="text-xs text-sky-700 underline hover:text-sky-900">Editar</button>
                          <button onClick={() => void eliminar(p)}
                                  className="text-xs text-red-600 underline hover:text-red-800">Borrar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
