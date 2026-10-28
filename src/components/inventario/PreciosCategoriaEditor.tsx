"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type PrecioRow = { categoria_id: string; nombre: string; precio: number };

/**
 * Editor de precios por rubro de cliente para un producto.
 * Se guarda con PUT /api/productos/[id]/precios-categoria — no depende
 * del guardado principal del producto (es un panel autónomo).
 */
export default function PreciosCategoriaEditor({ productoId }: { productoId: string }) {
  const [rows, setRows] = useState<PrecioRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/precios-categoria`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (r.ok && j.success) setRows(j.data.precios ?? []);
        else setError(j.error ?? `Error ${r.status}`);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Error de red.");
      } finally {
        if (alive) setCargando(false);
      }
    })();
    return () => { alive = false; };
  }, [productoId]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${productoId}/precios-categoria`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precios: rows.map((r) => ({ categoria_id: r.categoria_id, precio: r.precio })) }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      setMensaje("Precios guardados.");
      window.setTimeout(() => setMensaje(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los precios.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="text-xs text-slate-400">Cargando rubros…</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        No hay rubros de cliente activos.{" "}
        <a href="/configuracion/categorias-cliente" className="underline font-medium">Crearlas en Configuración</a>.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Precio especial por rubro de cliente</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Solo para excepciones. La regla general es el porcentaje de cada rubro
            (<a href="/configuracion/categorias-cliente" className="text-sky-700 underline">Configuración → Rubros de cliente</a>),
            que vale para todo el catálogo sin cargar nada acá. Un precio cargado
            en esta tabla gana sobre ese porcentaje, solo para este producto.
          </p>
        </div>
        <button onClick={guardar} disabled={guardando}
                className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-60">
          {guardando ? "Guardando…" : "Guardar precios"}
        </button>
      </div>
      {mensaje && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{mensaje}</div>}
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-3 py-2">Rubro</th>
            <th className="text-right px-3 py-2 w-40">Precio (Gs.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.categoria_id} className="border-t border-slate-100">
              <td className="px-3 py-2">{r.nombre}</td>
              <td className="px-3 py-2 text-right">
                <input
                  type="number" min="0" step="1"
                  value={r.precio || ""}
                  onChange={(e) => setRows((prev) => prev.map((x, ix) => ix === i ? { ...x, precio: Number(e.target.value) || 0 } : x))}
                  className="w-full text-right rounded border border-slate-200 px-2 py-1"
                  placeholder="0"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
