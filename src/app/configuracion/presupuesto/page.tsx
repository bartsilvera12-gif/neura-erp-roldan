"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Los textos que salen impresos en todos los presupuestos.
 *
 * Están acá y no escritos en cada presupuesto porque son siempre los mismos y
 * porque es el papel que después se discute: si cambia una cuenta bancaria o
 * un plazo, tiene que cambiar en un solo lugar y valer para los que vengan.
 */
type Plantilla = {
  forma_pago: string;
  validez: string;
  observaciones: string;
  anticipo_pct: number;
  updated_at?: string | null;
  updated_por?: string | null;
};

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function PlantillaPresupuestoPage() {
  const [pl, setPl] = useState<Plantilla | null>(null);
  const [editable, setEditable] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/presupuesto-plantilla", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setPl(j.data.plantilla as Plantilla);
      setEditable(j.data.editable === true);
      setAviso(typeof j.data.aviso === "string" ? j.data.aviso : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    if (!pl) return;
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      const r = await fetchWithSupabaseSession("/api/configuracion/presupuesto-plantilla", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pl),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setOk(true);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const set = <K extends keyof Plantilla>(k: K, v: Plantilla[K]) =>
    setPl((prev) => (prev ? { ...prev, [k]: v } : prev));

  const condiciones = (pl?.observaciones ?? "").split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/configuracion" className="text-sm text-sky-600 hover:underline">← Configuración</Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Textos del presupuesto</h1>
        <p className="text-slate-600">
          Lo que sale impreso en todos los presupuestos: forma de pago, validez de la oferta y las
          condiciones del pie. Se cambian acá una vez y valen para los que se emitan de ahora en más
          — los ya emitidos no se tocan.
        </p>
      </div>

      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{aviso}</div>
      )}
      {!editable && !aviso && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          Solo un administrador puede cambiar estos textos. Los ves como van a salir en el documento.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {!pl ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Anticipo requerido (%)</span>
              <input
                type="number" min={0} max={100} step="0.01"
                value={pl.anticipo_pct}
                disabled={!editable}
                onChange={(e) => set("anticipo_pct", Number(e.target.value))}
                className={`${inputClass} mt-1 tabular-nums disabled:bg-slate-50`}
              />
              <span className="mt-1 block text-xs text-slate-500">
                Sale en dos lugares del documento y se calcula sobre el total.
              </span>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Forma de pago</span>
              <input
                value={pl.forma_pago}
                disabled={!editable}
                onChange={(e) => set("forma_pago", e.target.value)}
                className={`${inputClass} mt-1 disabled:bg-slate-50`}
              />
              <span className="mt-1 block text-xs text-slate-500">
                Escribí <code className="font-mono">{"{anticipo}"}</code> donde vaya el porcentaje y se
                reemplaza solo al imprimir.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Validez de la oferta</span>
            <textarea
              rows={2}
              value={pl.validez}
              disabled={!editable}
              onChange={(e) => set("validez", e.target.value)}
              className={`${inputClass} mt-1 resize-none disabled:bg-slate-50`}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Observaciones / condiciones
              <span className="ml-2 text-xs font-normal text-slate-500">{condiciones} condición(es)</span>
            </span>
            <textarea
              rows={14}
              value={pl.observaciones}
              disabled={!editable}
              onChange={(e) => set("observaciones", e.target.value)}
              className={`${inputClass} mt-1 font-mono text-xs leading-relaxed disabled:bg-slate-50`}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Una condición por renglón. En el documento salen como viñetas, en el mismo orden. Si no
              entran en la hoja, siguen en una segunda: no se recortan.
            </span>
          </label>

          {editable && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={guardando}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {ok && <span className="text-sm font-medium text-emerald-700">Guardado.</span>}
              {pl.updated_por && (
                <span className="text-xs text-slate-500">Último cambio: {pl.updated_por}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
