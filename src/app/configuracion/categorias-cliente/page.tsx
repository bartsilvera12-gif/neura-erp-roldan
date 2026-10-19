"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Categoria = { id: string; nombre: string; orden: number; activa: boolean };

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function CategoriasClientePage() {
  const [items, setItems] = useState<Categoria[]>([]);
  const [nombre, setNombre] = useState("");
  // Orden vacío ⇒ el backend usa max(existente)+1 al crear. También se muestra
  // como hint en el placeholder para que Jaz sepa qué valor va a tomar.
  const [orden, setOrden] = useState<string>("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edición inline: id de la categoría que se está editando + valores en curso.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editOrden, setEditOrden] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const proximoOrden = items.length > 0 ? Math.max(...items.map((i) => i.orden)) + 1 : 0;

  async function cargar() {
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/categorias-cliente", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.success) setItems(j.data.categorias ?? []);
      else setError(j.error ?? `Error ${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    try {
      // Si el usuario dejó Orden en blanco, autocalculamos max+1 en el cliente.
      const ordenNum = orden.trim() === "" ? proximoOrden : Number(orden);
      const r = await fetchWithSupabaseSession("/api/categorias-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), orden: Number.isFinite(ordenNum) ? ordenNum : proximoOrden }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      setNombre(""); setOrden("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setCreando(false);
    }
  }

  function iniciarEdicion(c: Categoria) {
    setEditandoId(c.id);
    setEditNombre(c.nombre);
    setEditOrden(String(c.orden));
    setError(null);
  }
  function cancelarEdicion() {
    setEditandoId(null); setEditNombre(""); setEditOrden("");
  }
  async function guardarEdicion(c: Categoria) {
    const nombreNuevo = editNombre.trim();
    if (!nombreNuevo) { setError("El nombre es obligatorio."); return; }
    const ordenNuevo = editOrden.trim() === "" ? c.orden : Number(editOrden);
    if (!Number.isFinite(ordenNuevo)) { setError("El orden debe ser un número."); return; }
    setGuardandoEdit(true);
    try {
      await patch(c.id, { nombre: nombreNuevo, orden: ordenNuevo });
      cancelarEdicion();
    } finally { setGuardandoEdit(false); }
  }

  async function toggleActiva(c: Categoria) { await patch(c.id, { activa: !c.activa }); }
  async function eliminar(c: Categoria) {
    if (!window.confirm(`¿Borrar la categoría "${c.nombre}"?`)) return;
    try {
      const r = await fetchWithSupabaseSession(`/api/categorias-cliente/${c.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar.");
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const r = await fetchWithSupabaseSession(`/api/categorias-cliente/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Categorías de cliente</h1>
        <p className="text-slate-600">Grupos configurables (ej. Supermercado grande, Restaurante, Mayorista). Al asignar una categoría al cliente y cargar precios por categoría en el producto, la caja aplica el precio correcto automáticamente.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={crear} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Nueva categoría</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={`${inputClass} sm:col-span-2`} placeholder="Nombre (ej. Supermercado grande)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <input type="number" className={inputClass} placeholder={`Orden (auto: ${proximoOrden})`} value={orden} onChange={(e) => setOrden(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500">Dejá el orden vacío para que se ubique al final ({proximoOrden}).</p>
        <button disabled={creando} className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-60">
          {creando ? "Creando…" : "Crear categoría"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Categorías cargadas</h2>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">Todavía no hay categorías.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2 w-24">Orden</th>
                <th className="text-left px-4 py-2 w-32">Activa</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const isEditing = editandoId === c.id;
                return (
                <tr key={c.id} className={`border-t border-slate-100 ${isEditing ? "bg-amber-50/60" : ""}`}>
                  <td className="px-4 py-2 font-medium">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editNombre}
                        onChange={(e) => setEditNombre(e.target.value)}
                        className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
                      />
                    ) : c.nombre}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editOrden}
                        onChange={(e) => setEditOrden(e.target.value)}
                        className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
                      />
                    ) : c.orden}
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggleActiva(c)}
                            role="switch" aria-checked={c.activa}
                            disabled={isEditing}
                            className={`inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${c.activa ? "bg-emerald-500" : "bg-slate-300"}`}>
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${c.activa ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className={`ml-2 text-xs font-medium ${c.activa ? "text-emerald-700" : "text-slate-500"}`}>{c.activa ? "Sí" : "No"}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isEditing ? (
                      <div className="inline-flex gap-3">
                        <button onClick={() => guardarEdicion(c)} disabled={guardandoEdit} className="text-xs text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50">
                          {guardandoEdit ? "Guardando…" : "Guardar"}
                        </button>
                        <button onClick={cancelarEdicion} disabled={guardandoEdit} className="text-xs text-slate-500 hover:text-slate-800 underline">Cancelar</button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-3">
                        <button onClick={() => iniciarEdicion(c)} className="text-xs text-sky-700 hover:text-sky-900 underline">Editar</button>
                        <button onClick={() => eliminar(c)} className="text-xs text-red-600 hover:text-red-800 underline">Borrar</button>
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
