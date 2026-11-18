"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { useFacultades } from "@/lib/perfiles/use-facultades";
import { divisorIva } from "@/lib/precios/iva";
import { utilidadDeLineas } from "@/lib/contabilidad/punto-equilibrio";

type Cliente = { id: string; label: string; nombre_contacto?: string; empresa?: string };
type Producto = { id: string; nombre: string; sku: string; precio_venta: number; costo_promedio?: number; tipo_iva?: string | null };
type ItemLinea = { producto_id: string; nombre: string; cantidad: number; precio_unitario: number; costo: number; tipo_iva: string };

const gs = (n: number) => "Gs. " + new Intl.NumberFormat("es-PY").format(Math.round(n));

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]";

export default function NuevaOrdenVentaPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [numeroOrden, setNumeroOrden] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [fechaEntrega, setFechaEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ItemLinea[]>([]);
  const [prodSel, setProdSel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El desglose del pie es de administración; la utilidad, de quien ve costos.
  const { isAdmin } = useIsAdmin();
  const { tiene } = useFacultades();
  const verCostos = tiene("ver_costos");

  useEffect(() => {
    (async () => {
      const [rC, rP] = await Promise.all([
        fetchWithSupabaseSession("/api/clientes", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/productos", { cache: "no-store" }),
      ]);
      const jC = await rC.json();
      const jP = await rP.json();
      // /api/clientes devuelve `data: [array]` directo, no `data: { clientes: [...] }`.
      if (rC.ok && jC.success) {
        const rows = Array.isArray(jC.data) ? jC.data : (jC.data?.clientes ?? []);
        const clientesLite = (rows as Record<string, unknown>[]).map((row) => {
          const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
          return {
            id: String(row.id),
            label: s(row.empresa) || s(row.nombre_contacto) || s(row.nombre) || "Cliente",
            nombre_contacto: s(row.nombre_contacto) || undefined,
            empresa: s(row.empresa) || undefined,
          };
        });
        setClientes(clientesLite);
      }
      if (rP.ok && jP.success) setProductos(jP.data.productos ?? []);
    })();
  }, []);

  function agregar() {
    const p = productos.find((x) => x.id === prodSel);
    if (!p) return;
    if (items.some((i) => i.producto_id === p.id)) return;
    setItems((prev) => [...prev, {
      producto_id: p.id, nombre: p.nombre, cantidad: 1, precio_unitario: p.precio_venta,
      costo: Number(p.costo_promedio) || 0, tipo_iva: String(p.tipo_iva ?? "10%"),
    }]);
    setProdSel("");
  }

  const total = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
  const gravado = items.reduce((s, i) => s + (i.cantidad * i.precio_unitario) / divisorIva(i.tipo_iva), 0);
  // La misma cuenta que el punto de equilibrio.
  const util = utilidadDeLineas(items, divisorIva);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clienteId || !numeroOrden.trim()) {
      setError("Elegí cliente y número de orden.");
      return;
    }
    if (items.length === 0) { setError("Agregá al menos un producto."); return; }
    setSubmitting(true);
    try {
      const r = await fetchWithSupabaseSession("/api/ordenes-venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          numero_orden: numeroOrden.trim(),
          fecha, fecha_entrega_solicitada: fechaEntrega || null,
          observaciones: observaciones.trim() || null,
          items: items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, precio_unitario: i.precio_unitario })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      router.push("/ordenes-venta");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la orden.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/ordenes-venta" className="text-sm text-sky-600 hover:underline">← Órdenes de venta</Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Nueva orden de venta</h1>
        <p className="text-slate-600">Cargá una OC que recibiste de un cliente (Biggie, Casa Rica, etc.). Quedará en estado <b>pendiente</b>.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={guardar} className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Cliente</label>
            <SearchableSelect
              value={clienteId || null}
              onChange={(v) => setClienteId(v)}
              placeholder="— Elegí un cliente —"
              options={clientes.map((c) => ({ id: c.id, label: c.label ?? c.id }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">N° de orden del cliente</label>
            <input className={inputClass} value={numeroOrden} onChange={(e) => setNumeroOrden(e.target.value)}
                   placeholder="Ej: BIG-2026-001" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
            <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fecha de entrega solicitada</label>
            <input type="date" className={inputClass} value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Observaciones</label>
            <textarea className={inputClass} rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Ítems</h3>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <SearchableSelect
                value={prodSel || null}
                onChange={(v) => setProdSel(v)}
                placeholder="— Elegí un producto —"
                options={productos
                  .filter((p) => !items.some((it) => it.producto_id === p.id))
                  .map((p) => ({ id: p.id, label: p.nombre, hint: p.sku }))}
              />
            </div>
            <button type="button" onClick={agregar} disabled={!prodSel}
                    className="whitespace-nowrap rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
              Agregar
            </button>
          </div>
          {items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Producto</th>
                  <th className="text-right px-3 py-2 w-24">Cantidad</th>
                  <th className="text-right px-3 py-2 w-32">Precio unit.</th>
                  <th className="text-right px-3 py-2 w-32">Subtotal</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.producto_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{it.nombre}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min="1" step="1" value={it.cantidad || ""}
                             onChange={(e) => setItems((prev) => prev.map((x, ix) => ix === i ? { ...x, cantidad: Number(e.target.value) || 0 } : x))}
                             className="w-full text-right rounded border border-slate-200 px-2 py-1" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min="0" step="1" value={it.precio_unitario || ""}
                             onChange={(e) => setItems((prev) => prev.map((x, ix) => ix === i ? { ...x, precio_unitario: Number(e.target.value) || 0 } : x))}
                             className="w-full text-right rounded border border-slate-200 px-2 py-1" />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">Gs. {new Intl.NumberFormat("es-PY").format(Math.round(it.cantidad * it.precio_unitario))}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setItems((prev) => prev.filter((_, ix) => ix !== i))}
                              className="text-red-600 hover:text-red-800 text-xs">Quitar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length > 0 && (
            <div className="flex flex-wrap items-end justify-end gap-x-8 gap-y-2 border-t border-slate-200 pt-3">
              {isAdmin && (
                <>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">Ítems</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-700">{items.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">Gravado</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-700">{gs(gravado)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">IVA</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-700">{gs(total - gravado)}</p>
                  </div>
                </>
              )}
              {isAdmin && verCostos && (
                <div title={util.lineas_sin_costo > 0 ? "Hay artículos sin costo cargado: no entran en la cuenta." : undefined}>
                  <p className="text-[11px] font-medium text-slate-500">Utilidad{util.lineas_sin_costo > 0 ? " *" : ""}</p>
                  <p className={`text-sm font-semibold tabular-nums ${util.margen < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    {gs(util.margen)}
                    {util.margen_pct != null && (
                      <span className="ml-1 text-[11px] font-normal text-slate-500">
                        ({util.margen_pct.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%)
                      </span>
                    )}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium text-slate-500">Total</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{gs(total)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={submitting}
                  className="rounded-lg bg-slate-900 hover:bg-slate-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {submitting ? "Guardando…" : "Crear orden"}
          </button>
          <Link href="/ordenes-venta" className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
