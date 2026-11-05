"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { EstadoEmpleadoBadge, Iniciales } from "@/components/rrhh/EmpleadoBadges";
import { KeyRound, Search, UserPlus, Users, UserCheck, UserX, Wallet } from "lucide-react";

type Empleado = {
  id: string;
  nombre: string;
  legajo?: string | null;
  documento: string | null;
  cargo: string | null;
  tipo_empleado: string | null;
  departamento: string | null;
  fecha_ingreso: string | null;
  salario_base: number;
  moneda: string;
  estado: string;
  activo: boolean;
  usuario_id?: string | null;
  usuario_nombre?: string | null;
  usuario_email?: string | null;
};

type FiltroEstado = "activos" | "baja" | "todos";

const fmtMonto = (n: number, moneda: string) =>
  `${moneda === "PYG" ? "Gs. " : moneda + " "}${new Intl.NumberFormat("es-PY").format(Math.round(n))}`;

const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

/** Antigüedad legible: "3 años", "8 meses", "12 días". */
function antiguedad(iso: string | null): string | null {
  if (!iso) return null;
  const desde = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (isNaN(desde.getTime())) return null;
  const dias = Math.floor((Date.now() - desde.getTime()) / 86_400_000);
  if (dias < 0) return "ingresa pronto";
  if (dias < 31) return `${dias} día${dias === 1 ? "" : "s"}`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 12) return `${meses} mes${meses === 1 ? "" : "es"}`;
  const anios = Math.floor(meses / 12);
  return `${anios} año${anios === 1 ? "" : "s"}`;
}

/** Legajos numéricos en orden numérico ("0002" antes que "0010"); los de texto después. */
function compararLegajo(a?: string | null, b?: string | null): number {
  const na = /^\d+$/.test(a ?? "") ? Number(a) : Infinity;
  const nb = /^\d+$/.test(b ?? "") ? Number(b) : Infinity;
  if (na !== nb) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""), "es");
}

export default function EmpleadosPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<FiltroEstado>("activos");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/rrhh/empleados");
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.error || "Error");
        setEmpleados(j.data?.empleados ?? []);
        setAviso(j.data?.aviso ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tieneLegajos = empleados.some((e) => "legajo" in e);
  const activos = empleados.filter((e) => e.estado !== "baja");
  const deBaja = empleados.length - activos.length;
  const sinUsuario = activos.filter((e) => !e.usuario_id).length;
  // Masa salarial mensual en guaraníes, solo activos (los de baja ya no cobran).
  const nominaGs = activos.filter((e) => e.moneda === "PYG").reduce((s, e) => s + (Number(e.salario_base) || 0), 0);

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase();
    return empleados
      .filter((e) => (filtro === "todos" ? true : filtro === "baja" ? e.estado === "baja" : e.estado !== "baja"))
      .filter((e) =>
        !s ||
        e.nombre.toLowerCase().includes(s) ||
        (e.legajo ?? "").toLowerCase().includes(s) ||
        (e.documento ?? "").toLowerCase().includes(s) ||
        (e.cargo ?? "").toLowerCase().includes(s) ||
        (e.usuario_nombre ?? "").toLowerCase().includes(s) ||
        (e.usuario_email ?? "").toLowerCase().includes(s)
      )
      .sort((a, b) => (tieneLegajos ? compararLegajo(a.legajo, b.legajo) : a.nombre.localeCompare(b.nombre, "es")));
  }, [empleados, q, filtro, tieneLegajos]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow="RRHH"
        title="Empleados"
        description="Código, puesto y el usuario del sistema de cada persona."
        actions={
          <Link href="/rrhh/empleados/nuevo"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#3F8E91]">
            <UserPlus className="h-4 w-4" /> Nuevo empleado
          </Link>
        }
      />

      {aviso && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard compact label="Activos" value={activos.length} icon={<UserCheck className="h-4 w-4" />} accent />
          <StatCard compact label="De baja" value={deBaja} icon={<UserX className="h-4 w-4" />} />
          <StatCard compact label="Sin usuario del sistema" value={sinUsuario} icon={<KeyRound className="h-4 w-4" />}
            hint="activos que no entran al ERP" />
          <StatCard compact label="Salarios base del mes" value={fmtMonto(nominaGs, "PYG")} icon={<Wallet className="h-4 w-4" />}
            hint="activos, en guaraníes" />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Buscar por nombre, código, CI, cargo o usuario…" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {([["activos", "Activos"], ["baja", "De baja"], ["todos", "Todos"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFiltro(v)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${filtro === v ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {l}
            </button>
          ))}
        </div>
        <span className="text-sm text-slate-400 sm:ml-auto">{filtrados.length} de {empleados.length}</span>
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3">Puesto</th>
                  <th className="px-4 py-3">Usuario del sistema</th>
                  <th className="px-4 py-3">Ingreso</th>
                  <th className="px-4 py-3 text-right">Salario base</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center">
                      <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                      <p className="text-sm text-slate-500">
                        {empleados.length === 0 ? "Todavía no hay empleados cargados." : "Ningún empleado coincide con la búsqueda."}
                      </p>
                    </td>
                  </tr>
                )}
                {filtrados.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-[#4FAEB2]/[0.04]">
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                        {e.legajo || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/rrhh/empleados/${e.id}`} className="group flex items-center gap-3">
                        <Iniciales nombre={e.nombre} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800 group-hover:text-[#3F8E91]">{e.nombre}</span>
                          <span className="block text-xs text-slate-400">{e.documento ? `CI ${e.documento}` : "Sin documento"}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-slate-700">{e.cargo || "—"}</span>
                      {e.departamento && <span className="block text-xs text-slate-400">{e.departamento}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {e.usuario_id ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                          <KeyRound className="h-3.5 w-3.5 text-[#3F8E91]" />
                          <span className="min-w-0">
                            <span className="block truncate">{e.usuario_nombre ?? "Usuario"}</span>
                            {e.usuario_email && e.usuario_email !== e.usuario_nombre && (
                              <span className="block truncate text-xs text-slate-400">{e.usuario_email}</span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">No usa el sistema</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-slate-700">{fmtFecha(e.fecha_ingreso)}</span>
                      {antiguedad(e.fecha_ingreso) && <span className="block text-xs text-slate-400">{antiguedad(e.fecha_ingreso)}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {e.salario_base > 0 ? fmtMonto(e.salario_base, e.moneda) : "—"}
                    </td>
                    <td className="px-4 py-3"><EstadoEmpleadoBadge estado={e.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
