"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Sucursal = {
  id: string;
  codigo: string;
  nombre: string;
  es_principal: boolean;
  activa: boolean;
  establecimiento: string | null;
  punto_expedicion: string | null;
};

type UsuarioItem = { id: string; nombre: string | null; email: string | null };

type AsignacionItem = { usuario_id: string; sucursal_id: string };

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function ConfiguracionSucursalesPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Nueva sucursal
  const [nueva, setNueva] = useState({ codigo: "", nombre: "", establecimiento: "", punto_expedicion: "" });
  const [creando, setCreando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const [rSuc, rUsr, rAsig] = await Promise.all([
        fetchWithSupabaseSession("/api/configuracion/sucursales", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/configuracion/sucursales/usuarios", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/configuracion/sucursales/asignaciones", { cache: "no-store" }),
      ]);
      const jSuc = await rSuc.json();
      const jUsr = await rUsr.json();
      const jAsig = await rAsig.json();
      if (rSuc.ok && jSuc.success) setSucursales(jSuc.data.sucursales ?? []);
      if (rUsr.ok && jUsr.success) setUsuarios(jUsr.data.usuarios ?? []);
      if (rAsig.ok && jAsig.success) setAsignaciones(jAsig.data.asignaciones ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nueva.codigo.trim() || !nueva.nombre.trim()) {
      setError("Código y nombre son obligatorios.");
      return;
    }
    setCreando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/configuracion/sucursales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nueva),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? `Error ${res.status}`);
      setNueva({ codigo: "", nombre: "", establecimiento: "", punto_expedicion: "" });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setCreando(false);
    }
  }

  async function editar(s: Sucursal) {
    // Antes solo se podía cambiar el nombre; el resto de los datos de la
    // sucursal quedaban congelados desde el alta.
    const nombre = window.prompt("Nombre de la sucursal:", s.nombre);
    if (nombre == null || nombre.trim() === "") return;
    const codigo = window.prompt("Código (ej. ASU):", s.codigo);
    if (codigo == null || codigo.trim() === "") return;
    const establecimiento = window.prompt("Establecimiento (ej. 001):", s.establecimiento ?? "");
    if (establecimiento == null) return;
    const punto = window.prompt("Punto de expedición (ej. 002):", s.punto_expedicion ?? "");
    if (punto == null) return;
    await patch(s.id, {
      nombre: nombre.trim(),
      codigo: codigo.trim().toUpperCase(),
      establecimiento: establecimiento.trim() || null,
      punto_expedicion: punto.trim() || null,
    });
  }

  async function toggleActiva(s: Sucursal) {
    await patch(s.id, { activa: !s.activa });
  }

  async function eliminar(s: Sucursal) {
    if (s.es_principal) { alert("No se puede borrar la sucursal principal."); return; }
    if (!window.confirm(`¿Borrar la sucursal "${s.nombre}"?`)) return;
    try {
      const res = await fetchWithSupabaseSession(`/api/configuracion/sucursales/${s.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar.");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const res = await fetchWithSupabaseSession(`/api/configuracion/sucursales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
    }
  }

  async function asignar(usuarioId: string, sucursalId: string, marcar: boolean) {
    try {
      const res = await fetchWithSupabaseSession("/api/configuracion/sucursales/asignaciones", {
        method: marcar ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_id: usuarioId, sucursal_id: sucursalId }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar.");
    }
  }

  function tiene(usuarioId: string, sucursalId: string) {
    return asignaciones.some((a) => a.usuario_id === usuarioId && a.sucursal_id === sucursalId);
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Sucursales</h1>
        <p className="text-slate-600">Casa central y sucursales. Cada usuario opera en la que tiene activa.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Alta */}
      <form onSubmit={crear} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Nueva sucursal</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input className={inputClass} placeholder="Código (ej. ASU)" value={nueva.codigo}
                 onChange={(e) => setNueva((p) => ({ ...p, codigo: e.target.value.toUpperCase() }))} />
          <input className={inputClass} placeholder="Nombre" value={nueva.nombre}
                 onChange={(e) => setNueva((p) => ({ ...p, nombre: e.target.value }))} />
          <input className={inputClass} placeholder="Establecimiento (ej. 001)" value={nueva.establecimiento}
                 onChange={(e) => setNueva((p) => ({ ...p, establecimiento: e.target.value }))} />
          <input className={inputClass} placeholder="Punto expedición (ej. 002)" value={nueva.punto_expedicion}
                 onChange={(e) => setNueva((p) => ({ ...p, punto_expedicion: e.target.value }))} />
        </div>
        <button disabled={creando} className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-60">
          {creando ? "Creando…" : "Crear sucursal"}
        </button>
      </form>

      {/* Listado */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Sucursales de la empresa</h2>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : sucursales.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">Todavía no hay sucursales.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Estab / Punto</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.codigo}</td>
                  <td className="px-4 py-2 font-medium">
                    {s.nombre}
                    {s.es_principal && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Principal</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {(s.establecimiento ?? "—")} / {(s.punto_expedicion ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggleActiva(s)}
                            className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              s.activa ? "bg-emerald-500" : "bg-slate-300"
                            }`}
                            role="switch" aria-checked={s.activa}
                            title={s.activa ? "Activa (click para desactivar)" : "Inactiva (click para activar)"}>
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${s.activa ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className={`ml-2 text-xs font-medium ${s.activa ? "text-emerald-700" : "text-slate-500"}`}>
                      {s.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-3">
                      <button onClick={() => editar(s)} className="text-xs text-sky-700 hover:text-sky-900 underline">Editar</button>
                      <button onClick={() => eliminar(s)}
                              disabled={s.es_principal}
                              className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Matriz de asignación */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Asignación de usuarios a sucursales</h2>
          <p className="text-xs text-slate-500 mt-1">Los usuarios con rol <code>admin</code> ven todas las sucursales automáticamente. Para el resto, tildá las sucursales a las que tienen acceso.</p>
        </div>
        {usuarios.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No hay usuarios cargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 sticky left-0 bg-slate-50">Usuario</th>
                  {sucursales.map((s) => (
                    <th key={s.id} className="text-center px-3 py-2">{s.codigo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 sticky left-0 bg-white">
                      <div className="font-medium">{u.nombre ?? "—"}</div>
                      <div className="text-xs text-slate-500">{u.email ?? "—"}</div>
                    </td>
                    {sucursales.map((s) => {
                      const checked = tiene(u.id, s.id);
                      return (
                        <td key={s.id} className="text-center px-3 py-2">
                          <input type="checkbox" checked={checked}
                                 onChange={() => asignar(u.id, s.id, !checked)}
                                 className="h-4 w-4 accent-[#4FAEB2]" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
