"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PackageOpen, Truck, Package } from "lucide-react";
import { fetchDepositos, fetchStockDeposito, type Deposito, type StockItem } from "@/lib/multideposito/client";

function fmt(n: number) { return n.toLocaleString("es-PY"); }

export default function DepositosPage() {
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [ubicacionActiva, setUbicacionActiva] = useState<string>("");
  const [items, setItems] = useState<StockItem[]>([]);
  const [totalActual, setTotalActual] = useState(0);
  const [conStockActual, setConStockActual] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoStock, setCargandoStock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const r = await fetchDepositos();
      if (!r.ok) { setError(r.error); setCargando(false); return; }
      setDepositos(r.data.depositos);
      if (r.data.depositos.length > 0) setUbicacionActiva(r.data.depositos[0].id);
      setCargando(false);
    })();
  }, []);

  const cargarStock = useCallback(async (ubicacionId: string) => {
    if (!ubicacionId) return;
    setCargandoStock(true);
    const r = await fetchStockDeposito(ubicacionId);
    if (!r.ok) { setError(r.error); setCargandoStock(false); return; }
    setItems(r.data.items);
    setTotalActual(r.data.total_stock);
    setConStockActual(r.data.productos_con_stock);
    setCargandoStock(false);
  }, []);

  useEffect(() => {
    if (ubicacionActiva) cargarStock(ubicacionActiva);
  }, [ubicacionActiva, cargarStock]);

  const depositoActual = useMemo(() => depositos.find((d) => d.id === ubicacionActiva), [depositos, ubicacionActiva]);

  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-emerald-50/40 to-emerald-50/60 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-100/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-800">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" /> Inventario · Multi-depósito
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
              <span className="rounded-lg bg-white p-1.5 ring-1 ring-emerald-300/40 shadow-sm">
                <PackageOpen className="h-5 w-5 text-emerald-700" />
              </span>
              Depósitos
            </h1>
            <p className="mt-1 text-sm text-slate-500">Stock por ubicación. Las transferencias entre depósitos se hacen con Notas de Remisión.</p>
          </div>
          <Link
            href="/notas-remision/nueva"
            className="rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-emerald-500/30 hover:shadow-md inline-flex items-center gap-1.5"
          >
            <Truck className="h-4 w-4" />
            Emitir Nota de Remisión
          </Link>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando depósitos…</p>
      ) : depositos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No hay depósitos configurados en la empresa.
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mr-2">Depósito:</span>
              {depositos.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setUbicacionActiva(u.id)}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${ubicacionActiva === u.id ? "bg-emerald-600 text-white shadow" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {u.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{depositoActual?.nombre}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-emerald-700">{fmt(totalActual)}</p>
              <p className="mt-1 text-[11px] text-slate-500">unidades en stock</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Productos con stock</p>
              <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-800">{conStockActual} <span className="text-base font-normal text-slate-500">/ {items.length}</span></p>
              <p className="mt-1 text-[11px] text-slate-500">de {items.length} productos definidos</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Stock en {depositoActual?.nombre}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">SKU</th>
                    <th className="px-5 py-3">Producto</th>
                    <th className="px-5 py-3 text-right">Stock</th>
                    <th className="px-5 py-3">Unidad</th>
                  </tr>
                </thead>
                <tbody>
                  {cargandoStock ? (
                    <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400 italic">Sin productos configurados.</td></tr>
                  ) : items.map((p) => (
                    <tr key={p.producto_id} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.sku || "—"}</td>
                      <td className="px-5 py-3 font-semibold text-slate-800 flex items-center gap-2">
                        <Package className="h-4 w-4 text-slate-400" />{p.nombre}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums font-medium ${p.stock > 0 ? "text-slate-800" : "text-slate-400"}`}>
                        {fmt(p.stock)}
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-xs">{p.unidad || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 italic">
              La clasificación de huevos ingresa siempre a <strong>Casa Central</strong>. Para llevar stock a otro depósito se emite una NR y el destino debe aprobarla.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
