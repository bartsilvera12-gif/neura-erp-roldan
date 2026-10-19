"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Empleado = {
  id: string;
  nombre: string;
  documento: string | null;
  cargo: string | null;
  tipo_empleado: string | null;
  departamento: string | null;
  fecha_ingreso: string | null;
  salario_base: number;
  moneda: string;
  estado: string;
  activo: boolean;
};

const fmtGs = (n: number, moneda: string) =>
  `${moneda === "PYG" ? "Gs " : moneda + " "}${new Intl.NumberFormat("es-PY").format(Math.round(n))}`;

const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export default function EmpleadosPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/rrhh/empleados");
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Error");
      setEmpleados(j.data?.empleados ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return empleados;
    return empleados.filter((e) =>
      e.nombre.toLowerCase().includes(s) ||
      (e.documento ?? "").toLowerCase().includes(s) ||
      (e.cargo ?? "").toLowerCase().includes(s)
    );
  }, [empleados, q]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Empleados</h1>
          <p className="text-sm text-slate-500 mt-1">Gestión de recursos humanos.</p>
        </div>
        <Link
          href="/rrhh/empleados/nuevo"
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium"
        >
          + Nuevo empleado
        </Link>
      </div>

      <div className="mb-4">
        <input type="text" placeholder="Buscar por nombre, CI, cargo…" value={q} onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-md px-3 py-2 border border-slate-300 rounded-md text-sm" />
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && !error && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">CI</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Cargo</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Departamento</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Ingreso</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Salario</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Sin empleados.</td></tr>
              )}
              {filtrados.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/rrhh/empleados/${e.id}`} className="text-teal-700 hover:underline font-medium">
                      {e.nombre}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{e.documento || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{e.cargo || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{e.departamento || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtFecha(e.fecha_ingreso)}</td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {e.salario_base > 0 ? fmtGs(e.salario_base, e.moneda) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      e.estado === "activo" ? "bg-emerald-100 text-emerald-700" :
                      e.estado === "baja" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {e.estado}
                    </span>
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
