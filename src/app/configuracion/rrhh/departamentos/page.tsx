"use client";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Row = { id: string; slug: string; nombre: string; activo: boolean; orden: number; es_sistema: boolean };

const ENDPOINT = "/api/rrhh/departamentos-catalogo";
const RESOURCE_KEY = "departamentos";
const RESOURCE_SINGLE = "departamento";
const TITLE = "Departamentos";
const SUBTITLE = "Catálogo de departamentos de la empresa.";

export default function DepartamentosPage() {
  return <CatalogoCrud endpoint={ENDPOINT} listKey={RESOURCE_KEY} itemKey={RESOURCE_SINGLE} title={TITLE} subtitle={SUBTITLE} />;
}

export function CatalogoCrud({ endpoint, listKey, itemKey, title, subtitle }: {
  endpoint: string; listKey: string; itemKey: string; title: string; subtitle: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const res = await fetchWithSupabaseSession(`${endpoint}?all=1`);
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setRows((j.data?.[listKey] ?? []) as Row[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithSupabaseSession(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setNombre("");
      cargar();
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  async function toggleActivo(r: Row) {
    const res = await fetchWithSupabaseSession(`${endpoint}/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !r.activo }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    cargar();
  }

  async function eliminar(r: Row) {
    if (r.es_sistema) return alert("No se puede eliminar un item del sistema. Podés desactivarlo.");
    if (!confirm(`¿Eliminar "${r.nombre}"?`)) return;
    const res = await fetchWithSupabaseSession(`${endpoint}/${r.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    cargar();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
      </div>

      <form onSubmit={crear} className="mb-6 flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-slate-600 font-medium">Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
            placeholder="Ej: Recursos Humanos" />
        </div>
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
          {saving ? "Guardando…" : "+ Agregar"}
        </button>
      </form>

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Slug</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Estado</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Sin registros.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">
                    {r.nombre}
                    {r.es_sistema && <span className="ml-2 text-[10px] uppercase text-slate-400">sistema</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{r.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${r.activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                      {r.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActivo(r)} className="text-xs text-slate-600 hover:text-slate-900 mr-3">
                      {r.activo ? "Desactivar" : "Activar"}
                    </button>
                    {!r.es_sistema && (
                      <button onClick={() => eliminar(r)} className="text-xs text-red-600 hover:text-red-800">
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
