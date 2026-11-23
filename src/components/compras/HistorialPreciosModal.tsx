"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { Search, X } from "lucide-react";
import {
  precioEnDolares, totalesHistorial, variacionPorcentual,
  type FilaHistorial,
} from "@/lib/compras/historial-precios";

/**
 * Historial de precios de un artículo (pedido del cliente, con la pantalla del
 * sistema viejo a la vista): para un artículo y un rango de fechas, todas sus
 * compras con proveedor, factura, cantidad, precio en guaraníes, precio en
 * dólares y total, y los totales al pie.
 *
 * Se abre desde Compras y desde Órdenes de compra, que es donde hace falta
 * saber a cuánto se venía comprando antes de pedir otra vez.
 *
 * Solo lee: no cambia ninguna compra.
 */

type HitProducto = { id: string; nombre: string; sku: string; stock_actual: number; unidad_medida: string };

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const usd = (v: number) => v.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fFecha = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
/** Hoy en Paraguay (UTC−3). */
const hoyPy = (menosDias = 0) =>
  new Date(Date.now() - 3 * 3600_000 - menosDias * 86_400_000).toISOString().slice(0, 10);

export default function HistorialPreciosModal({
  productoIdInicial, productoNombreInicial, onClose,
}: {
  /** Si se abre desde una línea que ya tiene artículo, arranca con ese. */
  productoIdInicial?: string | null;
  productoNombreInicial?: string | null;
  onClose: () => void;
}) {
  const [productoId, setProductoId] = useState(productoIdInicial ?? "");
  const [productoNombre, setProductoNombre] = useState(productoNombreInicial ?? "");
  const [texto, setTexto] = useState(productoNombreInicial ?? "");
  const [hits, setHits] = useState<HitProducto[] | null>(null);
  // Por defecto, el último año: un historial de precios sin fondo no sirve
  // para comparar y tarda de más.
  const [desde, setDesde] = useState(hoyPy(365));
  const [hasta, setHasta] = useState(hoyPy());
  const [filas, setFilas] = useState<FilaHistorial[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tope, setTope] = useState(false);
  const [buscado, setBuscado] = useState(false);

  const buscar = useCallback(async () => {
    if (!productoId) { setError("Elegí el artículo."); return; }
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ producto_id: productoId });
      if (desde) sp.set("desde", desde);
      if (hasta) sp.set("hasta", hasta);
      const r = await apiFetch(`/api/compras/historial-precios?${sp}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `No se pudo leer el historial (${r.status}).`);
        setFilas([]);
        return;
      }
      setFilas((j.data?.filas ?? []) as FilaHistorial[]);
      setTope(j.data?.tope === true);
      setBuscado(true);
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }, [productoId, desde, hasta]);

  // Si se abrió desde una línea que ya tenía artículo, se busca solo.
  useEffect(() => {
    if (productoIdInicial) void buscar();
    // Solo al abrir: después lo dispara el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buscarArticulo() {
    const q = texto.trim();
    if (q.length < 2) { setError("Escribí al menos dos letras del artículo."); return; }
    setError(null);
    setHits([]);
    try {
      const r = await apiFetch(`/api/productos/search?q=${encodeURIComponent(q)}&limit=20`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setHits(null); setError(j?.error ?? "No se pudo buscar el artículo."); return; }
      setHits((j.data?.items ?? []) as HitProducto[]);
    } catch {
      setHits(null);
      setError("No se pudo buscar el artículo.");
    }
  }

  const totales = useMemo(() => totalesHistorial(filas), [filas]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-5xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Historial de precios</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              A cuánto se compró este artículo cada vez. Las compras anuladas no salen.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <label className="relative">
            <span className="text-[11px] font-medium text-slate-500">Artículo</span>
            <div className="mt-1 flex items-center gap-1">
              <input
                value={texto}
                onChange={(e) => { setTexto(e.target.value); setProductoId(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscarArticulo(); } }}
                placeholder="Buscá el artículo…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button" onClick={() => void buscarArticulo()}
                className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                title="Buscar el artículo en el inventario"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
            {hits && (
              <div className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white text-xs shadow-lg">
                {hits.length === 0 ? (
                  <p className="px-3 py-2 text-slate-500">No se encontró «{texto}».</p>
                ) : hits.map((h) => (
                  <button
                    key={h.id} type="button"
                    onClick={() => { setProductoId(h.id); setProductoNombre(h.nombre); setTexto(h.nombre); setHits(null); }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                  >
                    <span className="block font-medium text-slate-800">{h.nombre}</span>
                    {h.sku && <span className="block text-[10px] text-slate-500">{h.sku}</span>}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label>
            <span className="text-[11px] font-medium text-slate-500">Desde</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="text-[11px] font-medium text-slate-500">Hasta</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <button
            type="button" onClick={() => void buscar()} disabled={cargando || !productoId}
            className="mt-auto rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {cargando ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
        )}
        {tope && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Son las últimas 500 compras del período. Achicá el rango de fechas para verlas todas.
          </p>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">N° Compra</th>
                <th className="px-2 py-1.5 text-left font-semibold">Fecha</th>
                <th className="px-2 py-1.5 text-left font-semibold">Proveedor</th>
                <th className="px-2 py-1.5 text-left font-semibold">Factura</th>
                <th className="px-2 py-1.5 text-right font-semibold">Cantidad</th>
                <th className="px-2 py-1.5 text-right font-semibold">Precio Gs.</th>
                <th className="px-2 py-1.5 text-right font-semibold">P. Dólar</th>
                <th className="px-2 py-1.5 text-right font-semibold">Var.</th>
                <th className="px-2 py-1.5 text-right font-semibold">Total Gs.</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-2 py-8 text-center text-slate-400">
                    {!buscado
                      ? "Elegí un artículo y tocá Buscar."
                      : "Este artículo no se compró en el período elegido."}
                  </td>
                </tr>
              ) : filas.map((f, i) => {
                const pd = precioEnDolares(f);
                const v = variacionPorcentual(filas, i);
                return (
                  <tr key={`${f.numero_control}-${i}`} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{f.numero_control ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-600">{fFecha(f.fecha)}</td>
                    <td className="px-2 py-1.5 text-slate-700">{f.proveedor_nombre ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{f.numero_factura || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                      {(Number(f.cantidad) || 0).toLocaleString("es-PY")}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{gs(Number(f.costo_unitario) || 0)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                      {pd == null ? <span className="text-slate-300">—</span> : usd(pd)}
                    </td>
                    {/* Cuánto cambió contra la compra anterior: es lo que se
                        viene a mirar acá. */}
                    <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${v == null ? "text-slate-300" : v > 0 ? "text-rose-600" : v < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                      {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{gs(Number(f.total) || 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-amber-50/60 font-semibold text-slate-800">
                  <td className="px-2 py-2 text-[11px] uppercase tracking-wide text-slate-500" colSpan={4}>
                    Totales · {totales.compras} compra{totales.compras === 1 ? "" : "s"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{totales.cantidad.toLocaleString("es-PY")}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums" title="Suma de las compras hechas en dólares">
                    {totales.usd > 0 ? usd(totales.usd) : <span className="font-normal text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums">{gs(totales.gs)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {productoNombre && (
          <p className="mt-2 text-[11px] text-slate-500">
            Artículo: <span className="font-medium text-slate-700">{productoNombre}</span>
          </p>
        )}
        <p className="mt-1 text-[11px] text-slate-400">
          El precio en dólares sale solo en las compras hechas en dólares: una compra en guaraníes
          no guardó ninguna cotización, y convertirla con la de hoy sería un número inventado.
        </p>
      </div>
    </div>
  );
}
