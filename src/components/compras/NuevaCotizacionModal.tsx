"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { Plus, Trash2 } from "lucide-react";
import Selector from "@/components/ui/Selector";

/**
 * Armar un pedido de cotización: la lista de artículos que se le va a pedir a
 * varios proveedores.
 *
 * ── SE PUEDE TRAER DE BAJO MÍNIMO ──────────────────────────────────────────
 *   Que es de donde sale la mayoría de los pedidos: lo que falta reponer. Se
 *   puede filtrar por rubro, porque un proveedor no cotiza chapa y tornillos
 *   en el mismo pedido.
 */

type Item = { descripcion: string; cantidad: number; unidad: string; producto_id?: string | null };
type Rubro = { id: string; nombre: string };

const vacio = (): Item => ({ descripcion: "", cantidad: 1, unidad: "UNIDAD" });

export default function NuevaCotizacionModal({
  onClose, onCreada,
}: {
  onClose: () => void;
  onCreada: (id: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([vacio()]);
  const [observaciones, setObservaciones] = useState("");
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [rubro, setRubro] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/api/inventario/categorias");
        const j = await r.json().catch(() => ({}));
        const cats = (j?.data?.categorias ?? []) as Array<Record<string, unknown>>;
        setRubros(
          cats.map((c) => ({ id: String(c.id), nombre: String(c.nombre ?? "") }))
            .filter((c) => c.nombre)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        );
      } catch { /* sin rubros, se cargan los artículos a mano */ }
    })();
  }, []);

  /** Trae lo que está bajo mínimo, opcionalmente de un rubro. */
  async function traerBajoMinimo() {
    setTrayendo(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (rubro) p.set("rubro", rubro);
      const r = await apiFetch(`/api/inventario/bajo-minimo?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo traer la lista.");

      const nuevos: Item[] = [];
      for (const g of (j.data?.grupos ?? []) as Array<Record<string, unknown>>) {
        for (const a of (g.articulos ?? []) as Array<Record<string, unknown>>) {
          const falta = Math.max(0, Number(a.stock_minimo ?? 0) - Number(a.stock_actual ?? 0));
          if (falta <= 0) continue;
          nuevos.push({
            producto_id: String(a.producto_id),
            descripcion: a.sku ? `${a.nombre} (${a.sku})` : String(a.nombre),
            cantidad: falta,
            unidad: String(a.unidad ?? "") || "UNIDAD",
          });
        }
      }
      if (nuevos.length === 0) {
        setError(rubro ? "Ese rubro no tiene nada bajo mínimo." : "No hay nada por debajo del mínimo.");
        return;
      }
      // Reemplaza en vez de sumar: apretar dos veces duplicaría los artículos.
      setItems(nuevos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo traer la lista.");
    } finally {
      setTrayendo(false);
    }
  }

  function cambiar(i: number, campo: keyof Item, valor: string) {
    setItems((prev) => prev.map((it, k) => {
      if (k !== i) return it;
      if (campo === "cantidad") {
        return { ...it, cantidad: Number(valor.replace(/[^\d.,]/g, "").replace(",", ".")) || 0 };
      }
      return { ...it, [campo]: valor };
    }));
  }

  const conDescripcion = items.filter((i) => i.descripcion.trim() !== "");

  async function guardar() {
    if (conDescripcion.length === 0) { setError("Agregá al menos un artículo."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/compras/cotizaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: conDescripcion, observaciones: observaciones.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onCreada(String(j.data?.id ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Pedir cotización</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          La lista de artículos que se le va a pedir a varios proveedores.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rubro</span>
            <Selector
              value={rubro} onChange={(e) => setRubro(e.target.value)}
              className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </Selector>
          </label>
          <button
            type="button" onClick={() => void traerBajoMinimo()} disabled={trayendo}
            className="rounded-lg border border-[#4FAEB2] px-3 py-2 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/10 disabled:opacity-50"
          >
            {trayendo ? "Trayendo…" : "Traer lo que está bajo mínimo"}
          </button>
          <p className="w-full text-[10px] leading-snug text-slate-500">
            Trae los artículos por debajo del mínimo con la cantidad que falta. Filtrá por rubro: un
            proveedor no cotiza chapa y tornillos en el mismo pedido.
          </p>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Artículo</th>
                <th className="w-24 px-2 py-1.5 text-right font-semibold">Cantidad</th>
                <th className="w-24 px-2 py-1.5 text-left font-semibold">Unidad</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input
                      value={it.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                      placeholder="Qué se cotiza"
                      className="w-full rounded border border-transparent px-1.5 py-1 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.unidad} onChange={(e) => cambiar(i, "unidad", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {items.length > 1 && (
                      <button
                        type="button" onClick={() => setItems((p) => p.filter((_, k) => k !== i))}
                        className="text-slate-300 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button" onClick={() => setItems((p) => [...p, vacio()])}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#3F8E91] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar artículo
        </button>

        <label className="mt-3 block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observaciones</span>
          <textarea
            value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Ej: entrega en 15 días, cotizar con IVA incluido"
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
            type="button" onClick={() => void guardar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Creando…" : `Crear el pedido (${conDescripcion.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
