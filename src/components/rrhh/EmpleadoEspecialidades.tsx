"use client";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Especialidad = { id: string; nombre: string; activo: boolean };
type Asignacion = {
  id: string;
  especialidad_id: string;
  es_principal: boolean;
  nivel: string | null;
  observaciones: string | null;
  especialidades?: { nombre: string };
};

const NIVELES = ["aprendiz","intermedio","especialista","encargado"];

export default function EmpleadoEspecialidades({ empleadoId }: { empleadoId: string }) {
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [catalogo, setCatalogo] = useState<Especialidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEsp, setAddEsp] = useState("");
  const [addNivel, setAddNivel] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [ra, rc] = await Promise.all([
        fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/especialidades`),
        fetchWithSupabaseSession(`/api/rrhh/especialidades`),
      ]);
      const ja = await ra.json(); const jc = await rc.json();
      if (ja.success) setAsignaciones((ja.data?.especialidades ?? []) as Asignacion[]);
      if (jc.success) setCatalogo((jc.data?.especialidades ?? []) as Especialidad[]);
    } finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, [empleadoId]);

  async function guardar(items: Array<{ especialidad_id: string; nivel: string | null; es_principal?: boolean; observaciones?: string | null }>) {
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/especialidades`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const j = await res.json();
    if (!res.ok || !j.success) throw new Error(j.error || "Error");
  }

  async function agregar() {
    if (!addEsp) return;
    try {
      const nuevo = { especialidad_id: addEsp, nivel: addNivel || null };
      const items = [
        ...asignaciones.map((a) => ({ especialidad_id: a.especialidad_id, nivel: a.nivel, es_principal: a.es_principal, observaciones: a.observaciones })),
        nuevo,
      ];
      await guardar(items);
      setAddEsp(""); setAddNivel(""); cargar();
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
  }

  async function quitar(especialidad_id: string) {
    if (!confirm("¿Quitar esta especialidad?")) return;
    try {
      const items = asignaciones
        .filter((a) => a.especialidad_id !== especialidad_id)
        .map((a) => ({ especialidad_id: a.especialidad_id, nivel: a.nivel, es_principal: a.es_principal, observaciones: a.observaciones }));
      await guardar(items);
      cargar();
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
  }

  const yaAsignadas = new Set(asignaciones.map((a) => a.especialidad_id));
  const disponibles = catalogo.filter((c) => c.activo && !yaAsignadas.has(c.id));

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 mt-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Especialidades</h2>

      <div className="flex gap-2 items-end mb-4">
        <div className="flex-1">
          <label className="text-xs text-slate-600">Especialidad</label>
          <select value={addEsp} onChange={(e) => setAddEsp(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm">
            <option value="">— elegir —</option>
            {disponibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-600">Nivel</label>
          <select value={addNivel} onChange={(e) => setAddNivel(e.target.value)}
            className="mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm">
            <option value="">—</option>
            {NIVELES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="button" onClick={agregar} disabled={!addEsp}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
          Agregar
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-400">Cargando…</p> : (
        asignaciones.length === 0 ? <p className="text-sm text-slate-400">Sin especialidades asignadas.</p> :
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Especialidad</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Nivel</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {asignaciones.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{a.especialidades?.nombre ?? a.especialidad_id}</td>
                  <td className="px-3 py-2 text-slate-600">{a.nivel ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => quitar(a.especialidad_id)} className="text-xs text-red-600 hover:text-red-800">Quitar</button>
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
