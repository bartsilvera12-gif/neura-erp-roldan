"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";

type Ingreso = {
  id: string; created_at: string; usuario_id: string | null; usuario_nombre: string | null;
  dispositivo_id: string | null; dispositivo_nombre: string | null; sistema: string | null;
  navegador: string | null; ip: string | null; sucursal_id: string | null;
};

function fechaHora(iso: string) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Reporte de ingresos (pedido del cliente): quién entró, cuándo, desde qué IP
 * y desde qué equipo, todos juntos y con filtros. Antes había que abrir cada
 * usuario y bajar hasta el final de su ficha.
 */
export default function IngresosPage() {
  const [ingresos, setIngresos] = useState<Ingreso[] | null>(null);
  const [usuarios, setUsuarios] = useState<Array<{ id: string; nombre: string }>>([]);
  const [sucursales, setSucursales] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [usuario, setUsuario] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [q, setQ] = useState("");
  const [agrupar, setAgrupar] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    setIngresos(null);
    const p = new URLSearchParams();
    if (usuario) p.set("usuario", usuario);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (q.trim()) p.set("q", q.trim());
    try {
      const r = await fetchWithSupabaseSession(`/api/usuarios/ingresos?${p.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setIngresos(j.data.ingresos as Ingreso[]);
      setUsuarios(j.data.usuarios ?? []);
      setSucursales(j.data.sucursales ?? {});
      if (j.data.aviso) setError(j.data.aviso);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setIngresos([]);
    }
  }, [usuario, desde, hasta, q]);

  useEffect(() => { const t = setTimeout(() => void cargar(), 300); return () => clearTimeout(t); }, [cargar]);

  const equipo = (i: Ingreso) => i.dispositivo_nombre || (i.dispositivo_id ? i.dispositivo_id.slice(0, 8).toUpperCase() : "—");

  /** Por usuario: cuántas veces entró, desde cuántas IP y equipos, y la última vez. */
  const resumen = useMemo(() => {
    const m = new Map<string, { nombre: string; veces: number; ips: Set<string>; equipos: Set<string>; ultima: string }>();
    for (const i of ingresos ?? []) {
      const k = i.usuario_id ?? i.usuario_nombre ?? "—";
      const r = m.get(k) ?? { nombre: i.usuario_nombre ?? "—", veces: 0, ips: new Set(), equipos: new Set(), ultima: i.created_at };
      r.veces++;
      if (i.ip) r.ips.add(i.ip);
      r.equipos.add(equipo(i));
      if (i.created_at > r.ultima) r.ultima = i.created_at;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
  }, [ingresos]);

  const filasExport = (ingresos ?? []).map((i) => [
    fechaHora(i.created_at), i.usuario_nombre ?? "—", i.ip ?? "—", equipo(i),
    [i.sistema, i.navegador].filter(Boolean).join(" · "), i.sucursal_id ? sucursales[i.sucursal_id] ?? "—" : "—",
  ]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/usuarios" className="text-sm text-[#4FAEB2] hover:underline">← Usuarios</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Ingresos al sistema</h1>
          <p className="text-sm text-slate-500">Quién entró, cuándo, desde qué IP y desde qué equipo.</p>
        </div>
        {filasExport.length > 0 && (
          <AccionesTabla titulo="Ingresos al sistema" archivo="ingresos" columnas={["Fecha y hora", "Usuario", "IP", "Equipo", "Sistema", "Sucursal"]} filas={filasExport} />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Usuario
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">IP o equipo
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: 181.120 o Caja 1" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} className="h-4 w-4 accent-[#4FAEB2]" />
          Resumen por usuario
        </label>
      </div>

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">{error}</div>}

      {!ingresos ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : ingresos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No hay ingresos con esos filtros.</div>
      ) : agrupar ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3 text-right">Ingresos</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">Equipos</th><th className="px-4 py-3">Último</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {resumen.map((r) => (
                <tr key={r.nombre + r.ultima} className="align-top">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.nombre}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.veces}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{[...r.ips].join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{[...r.equipos].join(", ")}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fechaHora(r.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Fecha y hora</th><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">Equipo</th><th className="px-4 py-3">Sistema</th><th className="px-4 py-3">Sucursal</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ingresos.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fechaHora(i.created_at)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {i.usuario_id ? <Link href={`/usuarios/${i.usuario_id}`} className="hover:text-[#3F8E91]">{i.usuario_nombre ?? "—"}</Link> : (i.usuario_nombre ?? "—")}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{i.ip ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-700">{equipo(i)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{[i.sistema, i.navegador].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{i.sucursal_id ? sucursales[i.sucursal_id] ?? "—" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ingresos.length >= 2000 && <p className="px-4 py-2 text-xs text-amber-700">Se muestran los 2.000 más recientes: acotá las fechas para ver el resto.</p>}
        </div>
      )}
    </div>
  );
}
