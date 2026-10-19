"use client";

import { useEffect, useRef, useState } from "react";
import { Store, ChevronDown, Check } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Sucursal = {
  id: string;
  codigo: string;
  nombre: string;
  es_principal: boolean;
};

type ApiResp = {
  sucursales: Sucursal[];
  sucursal_activa_id: string | null;
};

/**
 * Switcher de sucursal en el header. Muestra la sucursal activa como badge
 * clickeable; al hacer click abre un menú con las sucursales del usuario.
 * Al elegir una, hace POST /api/sucursales/actual y recarga la página para
 * que TODA la app pase a filtrar por la nueva sucursal.
 *
 * Si el usuario tiene una sola sucursal, se muestra como badge estático sin
 * dropdown (no tiene sentido "cambiar" a la única que hay).
 */
export default function SucursalSwitcher() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [activaId, setActivaId] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/sucursales/mias", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: ApiResp };
        if (!alive || !res.ok || !json.success || !json.data) return;
        setSucursales(json.data.sucursales ?? []);
        setActivaId(json.data.sucursal_activa_id ?? null);
      } catch {
        /* silencioso: si falla, el switcher no aparece */
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!abierto) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  async function elegir(sucursalId: string) {
    if (sucursalId === activaId) { setAbierto(false); return; }
    setSwitching(true);
    try {
      const res = await fetchWithSupabaseSession("/api/sucursales/actual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursal_id: sucursalId }),
      });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        alert(json.error ?? "No se pudo cambiar la sucursal.");
        setSwitching(false);
        return;
      }
      // Recarga para que todos los endpoints re-resuelvan sucursal_id.
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error de red.");
      setSwitching(false);
    }
  }

  if (sucursales.length === 0) return null;
  const activa = sucursales.find((s) => s.id === activaId) ?? sucursales[0];
  const puedeElegir = sucursales.length > 1;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => puedeElegir && setAbierto((v) => !v)}
        disabled={switching || !puedeElegir}
        title={puedeElegir ? "Cambiar de sucursal" : `Operando en ${activa.nombre}`}
        className={`flex items-center gap-1.5 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1.5 text-xs font-semibold text-[#2F6F72] ${
          puedeElegir ? "hover:bg-[#4FAEB2]/20 cursor-pointer" : "cursor-default"
        } ${switching ? "opacity-60" : ""}`}
      >
        <Store className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[10rem] truncate">{activa.nombre}</span>
        {puedeElegir && <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
      </button>

      {abierto && puedeElegir && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Cambiar sucursal
          </div>
          <ul className="py-1">
            {sucursales.map((s) => {
              const activo = s.id === activaId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => elegir(s.id)}
                    disabled={switching}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      activo ? "bg-[#4FAEB2]/10 text-[#2F6F72] font-semibold" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex-1 truncate">
                      <span className="text-[11px] font-mono text-slate-400 mr-1.5">{s.codigo}</span>
                      {s.nombre}
                    </span>
                    {activo && <Check className="h-4 w-4 text-[#2F6F72]" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
