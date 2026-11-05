"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import Selector from "@/components/ui/Selector";

/**
 * Cargar lo que contestó UN proveedor: un precio por artículo.
 *
 * ── UN PROVEEDOR POR VEZ ───────────────────────────────────────────────────
 *   Los proveedores no contestan todos juntos: uno llama hoy, otro manda el
 *   mail el martes. Por eso se carga de a uno, y guardar al segundo no toca
 *   los precios del primero (el PUT solo reemplaza los de ese proveedor).
 *
 * ── EL RENGLÓN VACÍO NO ES UN CERO ─────────────────────────────────────────
 *   Lo que se deja en blanco es "no lo cotizó" y no se guarda. Si se guardara
 *   un cero, ese proveedor ganaría la comparación con un artículo que en
 *   realidad nunca ofreció.
 */

type Item = { id: string; descripcion: string; cantidad: number; unidad: string };
type Prov = { id: string; nombre: string };

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");

/** Lo tipeado a número: se admiten puntos de miles y coma decimal. */
function aNumero(v: string): number {
  const limpio = v.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(limpio) || 0;
}

export default function CargarPreciosModal({
  cotizacionId, items, onClose, onGuardado,
}: {
  cotizacionId: string;
  items: Item[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [proveedores, setProveedores] = useState<Prov[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  /** item_id → lo tipeado, tal cual lo escribió el usuario. */
  const [precios, setPrecios] = useState<Record<string, string>>({});
  /** Precios ya cargados, por proveedor, para poder corregirlos. */
  const [yaCargados, setYaCargados] = useState<Record<string, Record<string, number>>>({});
  const [plazo, setPlazo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [rProv, rDet] = await Promise.all([
          apiFetch("/api/proveedores", { cache: "no-store" }),
          apiFetch(`/api/compras/cotizaciones?id=${encodeURIComponent(cotizacionId)}`, { cache: "no-store" }),
        ]);
        const jProv = await rProv.json().catch(() => ({}));
        const jDet = await rDet.json().catch(() => ({}));
        if (!vivo) return;

        const provs = (jProv?.data?.proveedores ?? []) as Array<Record<string, unknown>>;
        setProveedores(
          provs.map((p) => ({ id: String(p.id), nombre: String(p.nombre ?? "") }))
            .filter((p) => p.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        );

        // Lo que ya está cargado, para que elegir un proveedor que contestó
        // antes muestre sus precios en vez de una grilla vacía: así se corrige
        // un precio mal tipeado sin tener que escribir los otros de nuevo.
        const filas = (jDet?.data?.filas ?? []) as Array<{
          item: { id: string }; precios: Record<string, number | null>;
        }>;
        const mapa: Record<string, Record<string, number>> = {};
        for (const f of filas) {
          for (const [prov, val] of Object.entries(f.precios ?? {})) {
            if (val == null) continue;
            (mapa[prov] ??= {})[f.item.id] = val;
          }
        }
        setYaCargados(mapa);
      } catch { /* sin lista, el proveedor se elige cuando cargue */ }
    })();
    return () => { vivo = false; };
  }, [cotizacionId]);

  /** Al cambiar de proveedor se traen SUS precios: los del anterior no quedan. */
  function elegirProveedor(id: string) {
    setProveedorId(id);
    setError(null);
    const previos = yaCargados[id] ?? {};
    const inicial: Record<string, string> = {};
    for (const it of items) {
      const v = previos[it.id];
      if (v != null) inicial[it.id] = String(v);
    }
    setPrecios(inicial);
  }

  const cargados = useMemo(
    () => items.filter((it) => aNumero(precios[it.id] ?? "") > 0),
    [items, precios]
  );
  const total = useMemo(
    () => cargados.reduce((a, it) => a + aNumero(precios[it.id] ?? "") * Number(it.cantidad || 0), 0),
    [cargados, precios]
  );

  async function guardar() {
    if (!proveedorId) { setError("Elegí el proveedor que contestó."); return; }
    if (cargados.length === 0) {
      setError("Cargá al menos un precio. Lo que quede en blanco es «no lo cotizó».");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/compras/cotizaciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cotizacionId,
          proveedor_id: proveedorId,
          precios: cargados.map((it) => ({
            item_id: it.id,
            precio_unitario: aNumero(precios[it.id] ?? ""),
            plazo_dias: plazo.trim() === "" ? null : Number(plazo.replace(/\D/g, "")) || null,
            observacion: observacion.trim() || null,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los precios.");
    } finally {
      setGuardando(false);
    }
  }

  const yaContesto = proveedorId ? Object.keys(yaCargados[proveedorId] ?? {}).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Cargar precios</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Lo que contestó un proveedor. Dejá en blanco lo que no cotizó: en blanco no es cero.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedor</span>
            <Selector
              value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)}
              className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Elegí el proveedor…</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{Object.keys(yaCargados[p.id] ?? {}).length > 0 ? " · ya cotizó" : ""}
                </option>
              ))}
            </Selector>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plazo (días)</span>
            <input
              value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, ""))}
              placeholder="Ej: 15"
              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          {yaContesto > 0 && (
            <p className="w-full text-[10px] leading-snug text-slate-500">
              Este proveedor ya tenía {yaContesto} {yaContesto === 1 ? "precio" : "precios"} cargados: están abajo
              para corregirlos. Al guardar se reemplazan los de él solo, los de los otros quedan como están.
            </p>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Artículo</th>
                <th className="w-20 px-2 py-1.5 text-right font-semibold">Cant.</th>
                <th className="w-32 px-2 py-1.5 text-right font-semibold">Precio unit.</th>
                <th className="w-28 px-2 py-1.5 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const p = aNumero(precios[it.id] ?? "");
                return (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-800">{it.descripcion}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                      {gs(Number(it.cantidad || 0))} {it.unidad}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={precios[it.id] ?? ""}
                        onChange={(e) => setPrecios((prev) => ({ ...prev, [it.id]: e.target.value }))}
                        placeholder="No cotizó"
                        disabled={!proveedorId}
                        className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none disabled:bg-slate-50"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                      {p > 0 ? gs(p * Number(it.cantidad || 0)) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td className="px-2 py-1.5 text-[11px] text-slate-500" colSpan={3}>
                  Cotizó {cargados.length} de {items.length}
                  {cargados.length > 0 && cargados.length < items.length
                    ? " · incompleto: su total no se puede comparar contra el de los que cotizaron todo"
                    : ""}
                </td>
                <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-900">
                  {gs(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <label className="mt-3 block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observación</span>
          <input
            value={observacion} onChange={(e) => setObservacion(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Ej: precios con IVA, válidos por 7 días"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void guardar()} disabled={guardando || !proveedorId}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : `Guardar ${cargados.length} ${cargados.length === 1 ? "precio" : "precios"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
