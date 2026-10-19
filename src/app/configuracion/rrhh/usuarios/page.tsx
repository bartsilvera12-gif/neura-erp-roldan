"use client";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Usuario = { id: string; nombre: string | null; email: string; rol: string | null; rol_rrhh: string | null; estado: string };

const ROLES: { value: string; label: string; hint: string }[] = [
  { value: "", label: "— sin rol RRHH —", hint: "Usa fallback del rol legacy" },
  { value: "admin", label: "Admin RRHH", hint: "Todo" },
  { value: "gestor", label: "Gestor", hint: "Empleados (solo ver) + salarios + compras" },
  { value: "rrhh", label: "RRHH", hint: "Empleados, cursos, vacaciones, marcaciones" },
  { value: "encargado_obra", label: "Encargado de obra", hint: "Empleados (ver) + marcaciones + compras" },
  { value: "empleado", label: "Empleado", hint: "Ver su propio perfil + solicitar vacaciones" },
];

export default function RRHHUsuariosPage() {
  const [rows, setRows] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/rrhh/admin/usuarios");
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setRows((j.data?.usuarios ?? []) as Usuario[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  async function cambiarRol(u: Usuario, rol_rrhh: string) {
    setSaving(u.id);
    try {
      const res = await fetchWithSupabaseSession(`/api/rrhh/admin/usuarios/${u.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rol_rrhh: rol_rrhh || null }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setRows((prev) => prev.map((x) => x.id === u.id ? { ...x, rol_rrhh: rol_rrhh || null } : x));
    } catch (err) { alert(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(null); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Usuarios RRHH</h1>
        <p className="text-sm text-slate-500 mt-1">Asignar rol RRHH granular a cada usuario. Este rol se suma al rol legacy del ERP.</p>
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Rol ERP</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Rol RRHH</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Sin usuarios.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 text-slate-800">{u.nombre ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-slate-500">{u.rol ?? "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.rol_rrhh ?? ""}
                      onChange={(e) => cambiarRol(u, e.target.value)}
                      disabled={saving === u.id}
                      className="px-2 py-1 border border-slate-300 rounded-md text-sm min-w-[220px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value} title={r.hint}>{r.label}</option>
                      ))}
                    </select>
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
