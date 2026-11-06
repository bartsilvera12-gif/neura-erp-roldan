"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Boton from "@/components/ui/Boton";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

/**
 * El salario mínimo de la empresa.
 *
 * ── POR QUÉ ESTÁ ACÁ Y NO EN CADA FICHA ────────────────────────────────────
 *   A muchos empleados se les declara al IPS el salario mínimo en vez del que
 *   cobran. Si ese monto estuviera copiado en cada ficha, al subir por decreto
 *   habría que entrar empleado por empleado, y el que se olvidara quedaría
 *   declarando por debajo del mínimo legal sin que nada lo avise.
 *
 *   Acá se cambia una vez y todos los marcados "sobre el mínimo" quedan al día.
 */

const gs = (v: number) => `Gs. ${Math.round(v).toLocaleString("es-PY")}`;

export default function ParametrosRrhhPage() {
  const [minimo, setMinimo] = useState("");
  const [desde, setDesde] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/api/rrhh/parametros", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setMinimo(j.data?.salario_minimo == null ? "" : String(j.data.salario_minimo));
      setDesde(j.data?.minimo_vigente_desde ?? "");
      setAviso(j.data?.aviso ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      const r = await apiFetch("/api/rrhh/parametros", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salario_minimo: minimo.trim() === "" ? null : Number(minimo),
          minimo_vigente_desde: desde || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo guardar.");
      setOk("Guardado.");
      setTimeout(() => setOk(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const n = Number(minimo) || 0;
  const campo = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        backHref="/configuracion"
        backLabel="Volver a Configuración"
        eyebrow="Configuración · RRHH"
        title="Salario mínimo"
        description="El monto que se le declara al IPS por los empleados marcados «sobre el mínimo»."
      />

      {aviso && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{aviso}</p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Salario mínimo mensual</span>
              <input
                type="number" min="0" value={minimo} onChange={(e) => setMinimo(e.target.value)}
                placeholder="Ej: 2899048" className={`${campo} tabular-nums`}
              />
              {n > 0 && (
                <span className="mt-1 block text-[11px] text-slate-500">
                  {gs(n)} · el 9% del empleado son {gs(n * 0.09)}
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Vigente desde</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={campo} />
              <span className="mt-1 block text-[11px] text-slate-500">
                Para saber si el que está cargado quedó viejo.
              </span>
            </label>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            No viene con un valor puesto a propósito: lo fija un decreto y cambia, así que dejarlo
            escrito en el sistema sería dejar escrito algo que en algún momento deja de ser cierto.
            Cargalo una vez y, cuando suba, cambialo acá: todos los empleados marcados «sobre el
            mínimo» quedan al día solos.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <Boton onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Boton>
            {ok && <span className="text-xs font-medium text-emerald-700">{ok}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
