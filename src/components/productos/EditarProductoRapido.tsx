"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type ProductoEditable = {
  id: string;
  nombre: string;
  precio_venta: number;
  precio_mayorista?: number | null;
  precio_distribuidor?: number | null;
  tipo_iva?: "EXENTA" | "5%" | "10%" | null;
};

/**
 * Editar la ficha de un producto sin salir de la caja (pedido del cliente):
 * doble clic en la línea o el lápiz. Solo administradores —la API lo exige—.
 * Lo que se cambia acá cambia el PRODUCTO, no solo esta venta.
 *
 * Todo por teclado: Enter guarda, Esc cierra.
 */
export default function EditarProductoRapido({
  producto,
  onClose,
  onGuardado,
}: {
  producto: ProductoEditable;
  onClose: () => void;
  onGuardado: (p: ProductoEditable) => void;
}) {
  const [nombre, setNombre] = useState(producto.nombre);
  const [minorista, setMinorista] = useState(String(Math.round(producto.precio_venta || 0)));
  const [mayorista, setMayorista] = useState(producto.precio_mayorista ? String(Math.round(producto.precio_mayorista)) : "");
  const [distribuidor, setDistribuidor] = useState(producto.precio_distribuidor ? String(Math.round(producto.precio_distribuidor)) : "");
  const [iva, setIva] = useState<"EXENTA" | "5%" | "10%">(producto.tipo_iva ?? "10%");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => primero.current?.select(), 30); }, []);

  async function guardar() {
    const pv = Number(minorista.replace(/\D/g, ""));
    if (!nombre.trim()) { setError("El nombre no puede quedar vacío."); return; }
    if (!(pv > 0)) { setError("El precio minorista tiene que ser mayor a cero."); return; }
    const num = (s: string) => (s.replace(/\D/g, "") === "" ? null : Number(s.replace(/\D/g, "")));
    const cambios = {
      nombre: nombre.trim(),
      precio_venta: pv,
      precio_mayorista: num(mayorista),
      precio_distribuidor: num(distribuidor),
      tipo_iva: iva,
    };
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/productos/${producto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? "No se pudo guardar el producto.");
      onGuardado({ ...producto, ...cambios, nombre: cambios.nombre.toUpperCase() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setGuardando(false);
    }
  }

  const campo = "w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]";
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void guardar(); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !guardando) onClose(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onKeyDown={tecla}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Editar producto</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Cambia la ficha del producto. Enter guarda · Esc cierra.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Nombre</span>
            <input ref={primero} value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Minorista</span>
              <input inputMode="numeric" value={minorista} onChange={(e) => setMinorista(e.target.value)} className={`${campo} text-right tabular-nums`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Mayorista</span>
              <input inputMode="numeric" value={mayorista} onChange={(e) => setMayorista(e.target.value)} className={`${campo} text-right tabular-nums`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Distribuidor</span>
              <input inputMode="numeric" value={distribuidor} onChange={(e) => setDistribuidor(e.target.value)} className={`${campo} text-right tabular-nums`} />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-600">IVA</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(["EXENTA", "5%", "10%"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setIva(v)}
                  className={`rounded-lg border-2 py-1.5 text-xs font-bold ${iva === v ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {v === "EXENTA" ? "Exenta" : v}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={guardando} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={guardando}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
