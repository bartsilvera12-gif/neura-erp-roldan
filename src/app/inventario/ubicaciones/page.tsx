"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface Ubicacion {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: string;
  parent_id: string | null;
  activo: boolean;
  sucursal_id: string | null;
}

interface Sucursal { id: string; nombre: string }

const TIPOS = ["deposito","salon","pasillo","gondola","estante","zona","otro"] as const;

export default function UbicacionesPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Ubicacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [tipo, setTipo] = useState<string>("deposito");
  const [parentId, setParentId] = useState("");
  const [sucursalId, setSucursalId] = useState<string>("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Vista de configuración: traemos TODAS las sucursales (todas_sucursales=1)
      // para que el admin pueda ver/gestionar los depósitos de cualquier sucursal
      // sin depender del switcher de arriba.
      const r = await fetch("/api/inventario/ubicaciones?todas=1&todas_sucursales=1", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.success) setItems(j.data.ubicaciones as Ubicacion[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  async function loadSucursales() {
    try {
      const r = await fetch("/api/sucursales", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.success) setSucursales((j.data?.sucursales ?? []) as Sucursal[]);
    } catch { /* silencioso */ }
  }
  useEffect(() => { load(); loadSucursales(); }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/ubicaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          tipo,
          parent_id: parentId || null,
          sucursal_id: sucursalId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre(""); setCodigo(""); setTipo("deposito"); setParentId(""); setSucursalId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(u: Ubicacion) {
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !u.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  /** Editar nombre y código. Antes solo se podía activar o desactivar. */
  async function editar(u: Ubicacion) {
    const nombre = window.prompt("Nombre del depósito:", u.nombre);
    if (nombre == null || nombre.trim() === "") return;
    const codigo = window.prompt("Código (opcional):", u.codigo ?? "");
    if (codigo == null) return;
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim() || null }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  /** Borrar de verdad. El backend rechaza si tiene stock, hijas o movimientos. */
  async function eliminar(u: Ubicacion) {
    if (!window.confirm(`¿Borrar el depósito "${u.nombre}"? No se puede deshacer.`)) return;
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo borrar.");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Depósitos y ubicaciones</h1>
          <p className="text-gray-600">
            Donde se almacena físicamente cada producto: depósitos, salones, pasillos, góndolas, estantes, zonas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportExcelButton url="/api/inventario/ubicaciones/export" />
          <ImportExcelButton
            entidad="Ubicaciones"
            previewUrl="/api/inventario/ubicaciones/import/preview"
            commitUrl="/api/inventario/ubicaciones/import/commit"
            templateUrl="/api/inventario/ubicaciones/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link href="/inventario" className="text-sm text-sky-700 hover:text-sky-900 underline">
            ← Volver a Inventario
          </Link>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nueva ubicación
        </p>
        <form onSubmit={handleCrear} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Depósito central"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: DEP-01"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Sucursal <span className="text-red-500">*</span></label>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              required
            >
              <option value="">— Elegí una sucursal —</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Ubicación padre (opcional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} ({i.tipo})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear ubicación"}
            </button>
          </div>
        </form>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Todavía no cargaste ubicaciones.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Sucursal</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Padre</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const parent = items.find((i) => i.id === u.parent_id);
                const suc = sucursales.find((s) => s.id === u.sucursal_id);
                return (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{u.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">{suc?.nombre ?? <span className="text-amber-600">Sin sucursal</span>}</td>
                    <td className="px-4 py-2 text-gray-500">{u.tipo}</td>
                    <td className="px-4 py-2 text-gray-500">{u.codigo ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{parent?.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      {u.activo ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Activo</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => void editar(u)}
                        className="text-xs text-sky-700 underline hover:text-sky-900"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActivo(u)}
                        className="ml-3 text-xs text-slate-600 underline hover:text-slate-900"
                      >
                        {u.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        onClick={() => void eliminar(u)}
                        className="ml-3 text-xs text-red-700 underline hover:text-red-900"
                      >
                        Eliminar
                      </button>
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
