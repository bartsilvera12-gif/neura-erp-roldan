"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getCategoriasProveedor,
  createCategoriaProveedor,
  updateCategoriaProveedor,
  deleteCategoriaProveedor,
} from "@/lib/proveedores/storage";
import type { ProveedorCategoria } from "@/lib/proveedores/types";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9]";

export default function ProveedorCategoriasPage() {
  const [lista, setLista] = useState<ProveedorCategoria[]>([]);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editDesc, setEditDesc] = useState("");

  async function reload() {
    const rows = await getCategoriasProveedor({ todas: true });
    setLista(rows);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = nombre.trim();
    if (!n) return;
    const res = await createCategoriaProveedor({
      nombre: n,
      descripcion: descripcion.trim() || null,
      activo: true,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNombre("");
    setDescripcion("");
    await reload();
  }

  function startEdit(c: ProveedorCategoria) {
    setEditingId(c.id);
    setEditNombre(c.nombre);
    setEditDesc(c.descripcion ?? "");
  }

  async function saveEdit() {
    if (!editingId) return;
    const res = await updateCategoriaProveedor(editingId, {
      nombre: editNombre.trim(),
      descripcion: editDesc.trim() || null,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditingId(null);
    await reload();
  }

  async function toggleActivo(c: ProveedorCategoria) {
    const res = await updateCategoriaProveedor(c.id, { activo: !c.activo });
    if (!res.ok) setError(res.error);
    else await reload();
  }

  async function eliminar(c: ProveedorCategoria) {
    if (!window.confirm(`¿Borrar la categoría "${c.nombre}"? Esta acción no se puede deshacer.`)) return;
    const res = await deleteCategoriaProveedor(c.id);
    if (!res.ok) setError(res.error);
    else await reload();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/proveedores" className="text-sm text-sky-600 hover:underline">
            ← Proveedores
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-800">Rubros de proveedor</h1>
          <p className="text-gray-600">Etiquetas para clasificar proveedores (textil, importación, etc.).</p>
          <div className="mt-3 max-w-2xl rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Los rubros que cargues acá <strong>se importan automáticamente</strong> como
            categorías en{" "}
            <Link href="/inventario/categorias" className="underline font-medium">
              Inventario / Categorías
            </Link>{" "}
            y aparecen disponibles al crear o editar productos.
          </div>
        </div>
      </div>

      <form
        onSubmit={handleCrear}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3 max-w-xl"
      >
        <h2 className="text-sm font-semibold text-slate-800">Nueva categoría</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Nombre *</label>
          <input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Descripción</label>
          <input className={inputClass} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]"
        >
          Crear
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-600">
              <th className="py-3 pr-4 font-semibold">Nombre</th>
              <th className="py-3 pr-4 font-semibold">Descripción</th>
              <th className="py-3 pr-4 font-semibold">Activo</th>
              <th className="py-3 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0">
                <td className="py-3 pr-4">
                  {editingId === c.id ? (
                    <input
                      className={inputClass}
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                    />
                  ) : (
                    <span className="font-medium text-slate-800">{c.nombre}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-slate-600">
                  {editingId === c.id ? (
                    <input className={inputClass} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  ) : (
                    c.descripcion ?? "—"
                  )}
                </td>
                <td className="py-3 pr-4">
                  <button
                    type="button"
                    onClick={() => toggleActivo(c)}
                    role="switch"
                    aria-checked={c.activo}
                    title={c.activo ? "Click para desactivar" : "Click para activar"}
                    className={`inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      c.activo ? "bg-emerald-500 focus:ring-emerald-500" : "bg-slate-300 focus:ring-slate-400"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                        c.activo ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                    <span className="sr-only">{c.activo ? "Sí" : "No"}</span>
                  </button>
                  <span className={`ml-2 text-xs font-medium ${c.activo ? "text-emerald-700" : "text-slate-500"}`}>
                    {c.activo ? "Sí" : "No"}
                  </span>
                </td>
                <td className="py-3">
                  {editingId === c.id ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        className="text-sky-600 font-medium hover:underline"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-slate-500 hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="text-sky-600 font-medium hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminar(c)}
                        className="text-red-600 font-medium hover:underline"
                      >
                        Borrar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="py-8 text-center text-slate-400">Sin categorías.</p>}
      </div>
    </div>
  );
}
