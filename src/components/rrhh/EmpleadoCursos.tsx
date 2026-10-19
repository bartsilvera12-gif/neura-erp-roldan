"use client";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type CursoCat = { id: string; nombre: string; tipo: string };
type Curso = {
  id: string;
  curso_id: string | null;
  nombre: string;
  tipo: string;
  entidad_emisora: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  estado: string;
};

const ESTADO_BADGE: Record<string, string> = {
  vigente: "bg-emerald-100 text-emerald-700",
  por_vencer: "bg-amber-100 text-amber-700",
  vencido: "bg-red-100 text-red-700",
  pendiente: "bg-slate-100 text-slate-600",
  en_revision: "bg-sky-100 text-sky-700",
};

export default function EmpleadoCursos({ empleadoId }: { empleadoId: string }) {
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [catalogo, setCatalogo] = useState<CursoCat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ curso_id: "", nombre: "", tipo: "curso", entidad_emisora: "", fecha_emision: "", fecha_vencimiento: "" });

  async function cargar() {
    setLoading(true);
    try {
      const [rc, rcat] = await Promise.all([
        fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/cursos`),
        fetchWithSupabaseSession(`/api/rrhh/cursos-catalogo`),
      ]);
      const jc = await rc.json(); const jcat = await rcat.json();
      if (jc.success) setCursos((jc.data?.cursos ?? []) as Curso[]);
      if (jcat.success) setCatalogo((jcat.data?.cursos ?? []) as CursoCat[]);
    } finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, [empleadoId]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/cursos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    setForm({ curso_id: "", nombre: "", tipo: "curso", entidad_emisora: "", fecha_emision: "", fecha_vencimiento: "" });
    setShowForm(false);
    cargar();
  }

  async function eliminar(c: Curso) {
    if (!confirm(`¿Eliminar "${c.nombre}"?`)) return;
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/cursos/${c.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    cargar();
  }

  function pickFromCatalog(cursoId: string) {
    const c = catalogo.find((x) => x.id === cursoId);
    setForm((f) => ({ ...f, curso_id: cursoId, nombre: c?.nombre ?? f.nombre, tipo: c?.tipo ?? f.tipo }));
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Cursos y certificaciones</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-xs font-medium">
          {showForm ? "Cancelar" : "+ Agregar"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={agregar} className="mb-4 p-3 border border-slate-200 rounded-md grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-600">Del catálogo (opcional)</label>
            <select value={form.curso_id} onChange={(e) => pickFromCatalog(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm">
              <option value="">— manual —</option>
              {catalogo.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600">Nombre *</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Tipo</label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm">
              <option value="curso">Curso</option>
              <option value="certificado">Certificado</option>
              <option value="habilitacion">Habilitación</option>
              <option value="documento_legal">Documento legal</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600">Entidad emisora</label>
            <input value={form.entidad_emisora} onChange={(e) => setForm({ ...form, entidad_emisora: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Fecha emisión</label>
            <input type="date" value={form.fecha_emision} onChange={(e) => setForm({ ...form, fecha_emision: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-600">Fecha vencimiento</label>
            <input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded-md text-sm" />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium">Guardar</button>
          </div>
        </form>
      )}

      {loading ? <p className="text-sm text-slate-400">Cargando…</p> : (
        cursos.length === 0 ? <p className="text-sm text-slate-400">Sin cursos registrados.</p> :
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Nombre</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Tipo</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Emisión</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Vencimiento</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {cursos.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.nombre}</td>
                  <td className="px-3 py-2 text-slate-600 capitalize">{c.tipo.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-slate-600">{c.fecha_emision ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{c.fecha_vencimiento ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${ESTADO_BADGE[c.estado] ?? ESTADO_BADGE.pendiente}`}>{c.estado.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => eliminar(c)} className="text-xs text-red-600 hover:text-red-800">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
