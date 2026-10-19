"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";

type Item = { descripcion: string; cantidad: string; unidad: string; precio_unitario: string };
type Orden = {
  id: string;
  numero_control: string;
  proveedor_nombre: string;
  fecha: string;
  moneda: string;
  estado: string;
  observaciones: string | null;
  items: { descripcion?: string; cantidad?: number; unidad?: string; precio_unitario?: number }[];
};

const UNIDADES = ["UNIDAD", "BOLSA", "KG", "G", "LT", "ML", "CAJA", "PAQUETE", "DOCENA", "LATA", "BOTELLA", "PORCION", "COMBO"];
const fmt = (n: number, m = "PYG") => (m === "USD" ? "USD " : "Gs ") + Math.round(Number(n) || 0).toLocaleString("es-PY");
const fmtFecha = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const inp = "w-full mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm";

async function imprimir(id: string) {
  try {
    const res = await fetchWithSupabaseSession(`/api/ordenes-compra/imprimir?id=${encodeURIComponent(id)}`);
    if (!res.ok) { alert("No se pudo generar la orden."); return; }
    const html = await res.text();
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  } catch { alert("No se pudo generar la orden."); }
}

export default function OrdenesDeCompraPage() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [provs, setProvs] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const [form, setForm] = useState({
    proveedor_id: "",
    proveedor_nombre: "",
    fecha: new Date().toISOString().slice(0, 10),
    moneda: "PYG" as "PYG" | "USD",
    observaciones: "",
  });
  const [items, setItems] = useState<Item[]>([]);
  const [nl, setNl] = useState<Item>({ descripcion: "", cantidad: "1", unidad: "UNIDAD", precio_unitario: "" });

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/ordenes-compra");
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      setOrdenes((j.data?.ordenes ?? []) as Orden[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); getProveedores().then((r) => setProvs(r.filter((p) => p.estado === "activo"))); }, []);

  const totalNuevo = useMemo(() => items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0), [items]);

  function agregarItem() {
    if (!nl.descripcion.trim()) return;
    setItems((prev) => [...prev, { ...nl, descripcion: nl.descripcion.trim() }]);
    setNl({ descripcion: "", cantidad: "1", unidad: nl.unidad, precio_unitario: "" });
  }

  async function guardar() {
    setError(null);
    const prov = provs.find((p) => String(p.id) === form.proveedor_id);
    const proveedorNombre = prov?.nombre ?? form.proveedor_nombre.trim();
    if (!proveedorNombre) { setError("Elegí o escribí el proveedor."); return; }
    // Si el usuario completó la fila inline pero no clickeó "+", la sumamos igual.
    let itemsToSend = items;
    if (items.length === 0 && nl.descripcion.trim()) {
      const inline: Item = { ...nl, descripcion: nl.descripcion.trim() };
      itemsToSend = [inline];
      setItems([inline]);
      setNl({ descripcion: "", cantidad: "1", unidad: nl.unidad, precio_unitario: "" });
    }
    if (itemsToSend.length === 0) { setError("Agregá al menos un ítem."); return; }
    setSaving(true);
    try {
      const payload = {
        proveedor_id: form.proveedor_id || null,
        proveedor_nombre: proveedorNombre,
        fecha: form.fecha,
        moneda: form.moneda,
        observaciones: form.observaciones.trim() || null,
        items: itemsToSend.map((it) => ({
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad) || 0,
          unidad: it.unidad,
          precio_unitario: Number(it.precio_unitario) || 0,
        })),
      };
      const editing = !!editandoId;
      const res = await fetchWithSupabaseSession("/api/ordenes-compra", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editandoId, ...payload } : payload),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error ?? "Error al guardar");
      setCreando(false);
      setEditandoId(null);
      setItems([]);
      setForm({ proveedor_id: "", proveedor_nombre: "", fecha: new Date().toISOString().slice(0, 10), moneda: "PYG", observaciones: "" });
      await cargar();
      if (!editing && j.data?.orden?.id) imprimir(String(j.data.orden.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  function editar(o: Orden) {
    setEditandoId(o.id);
    setCreando(true);
    setForm({
      proveedor_id: "",
      proveedor_nombre: o.proveedor_nombre ?? "",
      fecha: (o.fecha || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      moneda: o.moneda === "USD" ? "USD" : "PYG",
      observaciones: o.observaciones ?? "",
    });
    setItems((o.items ?? []).map((it) => ({
      descripcion: String(it.descripcion ?? ""),
      cantidad: String(it.cantidad ?? 1),
      unidad: String(it.unidad ?? "UNIDAD"),
      precio_unitario: String(it.precio_unitario ?? ""),
    })));
    setNl({ descripcion: "", cantidad: "1", unidad: "UNIDAD", precio_unitario: "" });
    // scroll al form
    if (typeof window !== "undefined") setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  async function eliminar(o: Orden) {
    if (!window.confirm(`¿Eliminar la orden ${o.numero_control}?`)) return;
    try {
      const res = await fetchWithSupabaseSession(`/api/ordenes-compra?id=${encodeURIComponent(o.id)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await cargar();
    } catch (e) { alert(e instanceof Error ? e.message : "No se pudo eliminar."); }
  }

  async function marcarRecibida(o: Orden) {
    try {
      const res = await fetchWithSupabaseSession("/api/ordenes-compra", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, estado: o.estado === "recibida" ? "pendiente" : "recibida" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await cargar();
    } catch (e) { alert(e instanceof Error ? e.message : "Error"); }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Compras · Pedidos</p>
          <h1 className="text-2xl font-bold text-slate-900">Órdenes de compra (pedidos)</h1>
          <p className="text-sm text-slate-500 mt-0.5">Pedidos para enviar al proveedor. No es una compra registrada; sirve para que el proveedor despache y facture.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/compras" className="text-sm text-[#4FAEB2] hover:underline">← Compras</Link>
          <button onClick={() => setCreando((v) => !v)} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#3F8E91]">
            {creando ? "Cerrar" : "+ Nueva orden"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {creando && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">{editandoId ? "Editar orden de compra" : "Nueva orden de compra"}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Proveedor</label>
              <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })} className={inp}>
                <option value="">— Elegí un proveedor —</option>
                {provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.ruc ? ` · ${p.ruc}` : ""}</option>)}
              </select>
              {!form.proveedor_id && (
                <input value={form.proveedor_nombre} onChange={(e) => setForm({ ...form, proveedor_nombre: e.target.value })}
                  className={inp} placeholder="…o escribí el nombre del proveedor" />
              )}
            </div>
            <div>
              <label className="text-xs text-slate-600">Fecha</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs text-slate-600">Moneda</label>
              <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as "PYG" | "USD" })} className={inp}>
                <option value="PYG">Guaraníes</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
          </div>

          {/* Alta de ítem */}
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
            <div className="col-span-2 md:col-span-5">
              <label className="text-xs text-slate-600">Descripción del producto</label>
              <input value={nl.descripcion} onChange={(e) => setNl({ ...nl, descripcion: e.target.value })} className={inp} placeholder="Ej: Balanceado aves iniciador 25kg" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Cantidad</label>
              <input type="number" min="0" step="any" value={nl.cantidad} onChange={(e) => setNl({ ...nl, cantidad: e.target.value })} className={inp} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Unidad</label>
              <select value={nl.unidad} onChange={(e) => setNl({ ...nl, unidad: e.target.value })} className={inp}>
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600">Precio unit. (opc.)</label>
              <input type="number" min="0" step="any" value={nl.precio_unitario} onChange={(e) => setNl({ ...nl, precio_unitario: e.target.value })} className={inp} />
            </div>
            <div className="md:col-span-1">
              <button type="button" onClick={agregarItem} className="w-full px-3 py-2 bg-[#4FAEB2] hover:bg-[#3F8E91] text-white rounded-md text-sm font-medium">+</button>
            </div>
          </div>

          {items.length > 0 && (
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-slate-400 text-xs border-b border-slate-200">
                <th className="text-left py-1">Descripción</th><th className="text-right py-1">Cant.</th><th className="text-left py-1">Unidad</th><th className="text-right py-1">Precio</th><th className="text-right py-1">Importe</th><th></th>
              </tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-800">{it.descripcion}</td>
                    <td className="py-1.5 text-right tabular-nums">{it.cantidad}</td>
                    <td className="py-1.5">{it.unidad}</td>
                    <td className="py-1.5 text-right tabular-nums">{Number(it.precio_unitario) > 0 ? fmt(Number(it.precio_unitario), form.moneda) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{Number(it.precio_unitario) > 0 ? fmt((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), form.moneda) : "—"}</td>
                    <td className="py-1.5 text-right"><button onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="text-red-500 text-xs hover:underline">Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {totalNuevo > 0 && <div className="mt-2 text-right text-sm font-semibold text-slate-800">Total estimado: {fmt(totalNuevo, form.moneda)}</div>}

          <div className="mt-3">
            <label className="text-xs text-slate-600">Observaciones</label>
            <textarea rows={2} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className={inp} placeholder="Instrucciones para el proveedor…" />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setCreando(false); setEditandoId(null); setItems([]); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="px-5 py-2 bg-[#4FAEB2] hover:bg-[#3F8E91] text-white rounded-md text-sm font-medium disabled:opacity-50">
              {saving ? "Guardando…" : editandoId ? "Guardar cambios" : "Guardar e imprimir"}
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-slate-500">Cargando…</p> : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">N°</th>
                <th className="text-left px-3 py-2 font-medium">Fecha</th>
                <th className="text-left px-3 py-2 font-medium">Proveedor</th>
                <th className="text-left px-3 py-2 font-medium">Ítems</th>
                <th className="text-right px-3 py-2 font-medium">Total est.</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-right px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ordenes.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin órdenes de compra.</td></tr>}
              {ordenes.map((o) => {
                const tot = (o.items ?? []).reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0);
                return (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs">{o.numero_control}</td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtFecha(o.fecha)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{o.proveedor_nombre}</td>
                    <td className="px-3 py-2.5 text-slate-600">{(o.items ?? []).length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{tot > 0 ? fmt(tot, o.moneda) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        o.estado === "recibida" ? "bg-emerald-100 text-emerald-700"
                          : o.estado === "anulada" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                      }`}>{o.estado}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => imprimir(o.id)} className="mr-3 text-xs font-medium text-sky-700 hover:underline">🖨 Imprimir</button>
                      <button onClick={() => editar(o)} className="mr-3 text-xs font-medium text-slate-700 hover:underline">✎ Editar</button>
                      <button onClick={() => marcarRecibida(o)} className="mr-3 text-xs font-medium text-emerald-700 hover:underline">{o.estado === "recibida" ? "Reabrir" : "Recibida"}</button>
                      <button onClick={() => eliminar(o)} className="text-xs font-medium text-rose-600 hover:underline">Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
