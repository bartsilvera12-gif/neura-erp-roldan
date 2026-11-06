"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Users } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { FacultadInfo } from "@/lib/perfiles/facultades";

/**
 * Perfiles de usuario: quién puede hacer qué.
 *
 * ── POR QUÉ CADA CASILLA TIENE SU EXPLICACIÓN AL LADO ─────────────────────
 *   "Cambiar el medio de pago" no se entiende solo. Lo que hay que saber para
 *   decidir si se la da o no es que mueve plata de una columna del arqueo a
 *   otra sin tocar el total, o sea que una caja que no cuadra puede
 *   "arreglarse" cambiando el medio en vez de buscando el error. Esa frase es
 *   la que hace que alguien piense antes de tildar.
 */

type Perfil = {
  id: string;
  clave: string | null;
  nombre: string;
  descripcion: string | null;
  nivel: "administrador" | "supervisor" | "usuario";
  activo: boolean;
  facultades: string[];
  usuarios: number;
};

const NIVELES: { v: Perfil["nivel"]; label: string; ayuda: string }[] = [
  { v: "usuario", label: "Usuario", ayuda: "Operación de mostrador. Entra a lo que le habiliten." },
  { v: "supervisor", label: "Supervisor", ayuda: "Puesto de control: entra a los cierres de caja." },
  { v: "administrador", label: "Administrador", ayuda: "Ve y configura todo el sistema." },
];

export default function PerfilesPage() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [catalogo, setCatalogo] = useState<FacultadInfo[]>([]);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/perfiles", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setPerfiles((j.data?.perfiles ?? []) as Perfil[]);
      setCatalogo((j.data?.catalogo ?? []) as FacultadInfo[]);
      setPuedeEditar(j.data?.puede_editar === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(p: Perfil, cambios: Partial<Perfil>) {
    setGuardando(p.id);
    setError(null);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/perfiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, ...cambios }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      setAviso(`"${cambios.nombre ?? p.nombre}" guardado.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(null);
    }
  }

  async function crear() {
    const nombre = nuevoNombre.trim();
    if (nombre.length < 2) return;
    setGuardando("nuevo");
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/perfiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, nivel: "usuario", facultades: [] }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo crear.");
      setNuevoNombre("");
      setAviso(`Perfil "${nombre}" creado, todavía sin facultades.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(null);
    }
  }

  function alternar(p: Perfil, clave: string) {
    const tiene = p.facultades.includes(clave);
    const next = tiene ? p.facultades.filter((f) => f !== clave) : [...p.facultades, clave];
    void guardar(p, { facultades: next });
  }

  const grupos = [...new Set(catalogo.map((f) => f.grupo))];

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Perfiles de usuario</h1>
        <p className="text-slate-600">
          Qué puede <strong>hacer</strong> cada puesto. Lo que puede <strong>ver</strong> se sigue
          asignando por módulos, en la ficha de cada usuario.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {aviso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{aviso}</div>}

      {!cargando && !puedeEditar && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Solo lectura: repartir facultades es la facultad que reparte todas las demás, así que la
          cambia un administrador.
        </div>
      )}

      <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-2.5 text-sm text-sky-900">
        Un usuario <strong>sin perfil asignado</strong> se sigue rigiendo por su nivel, igual que
        antes. El perfil no se suma al nivel: lo reemplaza.
      </div>

      {cargando ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-3">
          {perfiles.map((p) => {
            const abiertoEste = abierto === p.id;
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setAbierto(abiertoEste ? null : p.id)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {p.nombre}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {NIVELES.find((n) => n.v === p.nivel)?.label ?? p.nivel}
                      </span>
                    </p>
                    {p.descripcion && <p className="mt-0.5 text-xs leading-snug text-slate-500">{p.descripcion}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-slate-600">
                      {p.facultades.length === 0 ? "Sin facultades" : `${p.facultades.length} facultades`}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Users className="h-3 w-3" />
                      {p.usuarios === 1 ? "1 usuario" : `${p.usuarios} usuarios`}
                    </p>
                  </div>
                </button>

                {abiertoEste && (
                  <div className="space-y-4 border-t border-slate-100 px-5 py-4">
                    {grupos.map((g) => (
                      <div key={g}>
                        <p className="text-[11px] font-medium text-slate-400">{g}</p>
                        <div className="mt-1.5 space-y-2">
                          {catalogo.filter((f) => f.grupo === g).map((f) => (
                            <label key={f.clave} className="flex cursor-pointer items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={p.facultades.includes(f.clave)}
                                disabled={!puedeEditar || guardando === p.id}
                                onChange={() => alternar(p, f.clave)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-slate-700">{f.label}</span>
                                <span className="block text-[11px] leading-snug text-slate-500">{f.descripcion}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}

                    {p.usuarios > 0 && (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                        Lo que cambies acá le cambia a {p.usuarios === 1 ? "la persona" : `las ${p.usuarios} personas`} que
                        {p.usuarios === 1 ? " tiene" : " tienen"} este perfil, la próxima vez que entren.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {puedeEditar && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Nombre del perfil nuevo"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void crear()}
                disabled={nuevoNombre.trim().length < 2 || guardando === "nuevo"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Crear perfil
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
