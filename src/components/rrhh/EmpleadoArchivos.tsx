"use client";
import { useEffect, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Archivo = {
  id: string;
  nombre: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url: string | null;
};

function fmtSize(b: number | null) {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function EmpleadoArchivos({ empleadoId }: { empleadoId: string }) {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [nombre, setNombre] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function cargar() {
    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/archivos`);
      const j = await res.json();
      if (j.success) setArchivos((j.data?.archivos ?? []) as Archivo[]);
    } finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, [empleadoId]);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return alert("Elegí un archivo");
    if (!nombre.trim()) return alert("Poné un nombre descriptivo (ej: Contrato 2026, CI)");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("nombre", nombre.trim());
      const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/archivos`, {
        method: "POST", body: fd,
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setNombre("");
      if (fileRef.current) fileRef.current.value = "";
      cargar();
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
    finally { setUploading(false); }
  }

  async function eliminar(a: Archivo) {
    if (!confirm(`¿Eliminar "${a.nombre}"?`)) return;
    const res = await fetchWithSupabaseSession(`/api/rrhh/empleados/${empleadoId}/archivos?archivoId=${a.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.success) return alert(j.error || "Error");
    cargar();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 mt-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Archivos</h2>

      <form onSubmit={subir} className="mb-4 flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-slate-600">Nombre descriptivo</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm"
            placeholder="Ej: Contrato firmado 2026" />
        </div>
        <div>
          <label className="text-xs text-slate-600">Archivo (máx 25 MB)</label>
          <input ref={fileRef} type="file"
            className="mt-1 block text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-teal-50 file:text-teal-700 file:text-xs file:font-medium" />
        </div>
        <button type="submit" disabled={uploading}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium disabled:opacity-50">
          {uploading ? "Subiendo…" : "Subir"}
        </button>
      </form>

      {loading ? <p className="text-sm text-slate-400">Cargando…</p> : (
        archivos.length === 0 ? <p className="text-sm text-slate-400">Sin archivos.</p> :
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Nombre</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Tipo</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Tamaño</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Subido</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {archivos.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {a.url ? <a href={a.url} target="_blank" rel="noopener" className="text-teal-700 hover:underline">{a.nombre}</a> : a.nombre}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{a.mime_type ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmtSize(a.size_bytes)}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{a.created_at.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => eliminar(a)} className="text-xs text-red-600 hover:text-red-800">Eliminar</button>
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
