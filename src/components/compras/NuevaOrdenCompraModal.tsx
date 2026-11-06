"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import { Plus, Trash2 } from "lucide-react";
import Selector from "@/components/ui/Selector";

/**
 * Armar una orden de compra.
 *
 * Se usa desde dos lados: vacía, en Órdenes de compra, y precargada con lo que
 * falta, desde Inventario → Bajo mínimo. Es el mismo formulario porque es la
 * misma decisión —a quién le pido qué— y mantener dos sería garantizar que un
 * día se comporten distinto.
 *
 * ── EL PROVEEDOR SE ELIGE A MANO, Y NO ES UN DESCUIDO ──────────────────────
 *   Ningún artículo tiene `proveedor_principal_id` cargado (0 de 1.002), así
 *   que el sistema no tiene con qué adivinar a quién pedirle cada cosa. Se
 *   podría inferir del historial de compras, pero sería una suposición
 *   presentada como un dato. Mientras no se cargue el proveedor principal, lo
 *   elige la persona.
 */

export type ItemOrden = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
};

const vacio = (): ItemOrden => ({ descripcion: "", cantidad: 1, unidad: "UNIDAD", precio_unitario: 0 });

export default function NuevaOrdenCompraModal({
  itemsIniciales, origen, onClose, onCreada,
}: {
  /** Precarga, p. ej. lo que falta según Bajo mínimo. */
  itemsIniciales?: ItemOrden[];
  /** De dónde vino la precarga, para dejarlo escrito en la orden. */
  origen?: string;
  onClose: () => void;
  onCreada: (numeroControl: string) => void;
}) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [moneda, setMoneda] = useState<"PYG" | "USD">("PYG");
  const [fecha, setFecha] = useState(() => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState(origen ? `Armada desde ${origen}.` : "");
  const [items, setItems] = useState<ItemOrden[]>(
    itemsIniciales && itemsIniciales.length > 0 ? itemsIniciales : [vacio()]
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void getProveedores().then(setProveedores); }, []);

  const opciones = useMemo(
    () => proveedores.map((p) => ({ id: p.id, label: p.nombre })),
    [proveedores]
  );
  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;

  const total = items.reduce(
    (s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0), 0
  );
  const conDescripcion = items.filter((i) => i.descripcion.trim() !== "");

  function cambiar(i: number, campo: keyof ItemOrden, valor: string) {
    setItems((prev) => prev.map((it, k) => {
      if (k !== i) return it;
      if (campo === "cantidad" || campo === "precio_unitario") {
        return { ...it, [campo]: Number(valor.replace(/[^\d.,-]/g, "").replace(",", ".")) || 0 };
      }
      return { ...it, [campo]: valor };
    }));
  }

  async function guardar() {
    if (!proveedor) { setError("Elegí el proveedor."); return; }
    if (conDescripcion.length === 0) { setError("Agregá al menos un artículo."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedor.id,
          proveedor_nombre: proveedor.nombre,
          fecha, moneda,
          observaciones: observaciones.trim() || null,
          items: conDescripcion,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onCreada(String(j.data?.orden?.numero_control ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la orden.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Nueva orden de compra</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Es el pedido al proveedor. No mueve stock ni genera deuda: eso pasa cuando se carga la compra.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="sm:col-span-2">
            <span className="text-[11px] font-medium text-slate-500">Proveedor</span>
            <SearchableSelect
              value={proveedorId}
              onChange={(v) => { setProveedorId(v); setError(null); }}
              options={opciones}
              placeholder="Buscá el proveedor…"
              className="mt-1"
            />
            {proveedor && (proveedor.contacto || proveedor.email) && (
              <span className="mt-1 block text-[11px] text-slate-500">
                {proveedor.contacto ? `Vendedor: ${proveedor.contacto}` : ""}
                {proveedor.contacto && proveedor.email ? " · " : ""}
                {proveedor.email ?? ""}
              </span>
            )}
          </label>

          <label>
            <span className="text-[11px] font-medium text-slate-500">Fecha</span>
            <input
              type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="text-[11px] font-medium text-slate-500">Moneda</span>
            <Selector
              value={moneda} onChange={(e) => setMoneda(e.target.value === "USD" ? "USD" : "PYG")}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="PYG">Guaraníes</option>
              <option value="USD">Dólares</option>
            </Selector>
          </label>
          <span className="ml-auto text-sm text-slate-500">
            Total: <strong className="tabular-nums text-slate-800">
              {moneda === "USD" ? "US$ " : "Gs. "}{Math.round(total).toLocaleString("es-PY")}
            </strong>
          </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Artículo</th>
                <th className="w-24 px-2 py-1.5 text-right font-semibold">Cantidad</th>
                <th className="w-24 px-2 py-1.5 text-left font-semibold">Unidad</th>
                <th className="w-28 px-2 py-1.5 text-right font-semibold">Precio</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input
                      value={it.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                      placeholder="Qué se pide"
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
                  <td className="px-2 py-1">
                    <input
                      value={it.precio_unitario} onChange={(e) => cambiar(i, "precio_unitario", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
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
          <span className="text-[11px] font-medium text-slate-500">
            Observaciones <span className="font-normal normal-case text-slate-400">(salen en la hoja)</span>
          </span>
          <textarea
            value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Ej: entregar en depósito central, horario de mañana"
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
            {guardando ? "Creando…" : `Crear la orden (${conDescripcion.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
