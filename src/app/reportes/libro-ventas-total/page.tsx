"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

interface Row {
  origen_tipo: "factura" | "ticket";
  origen: string;
  fecha: string | null;
  cliente: string | null;
  ruc: string | null;
  numero: string | null;
  cdc: string | null;
  condicion: string | null;
  metodo_pago: string | null;
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  estado: string;
  venta_id: string;
  factura_id: string | null;
}

interface Totals {
  exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number; total: number;
  cantidad: number; cantidad_facturadas: number; cantidad_tickets: number;
  total_facturadas: number; total_tickets: number;
}

const fmt = (n: number) => "Gs " + new Intl.NumberFormat("es-PY").format(Math.round(Number(n) || 0));
const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const today = new Date().toISOString().slice(0, 10);
const startMonth = today.slice(0, 8) + "01";

export default function LibroVentasTotalPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState(startMonth);
  const [hasta, setHasta] = useState(today);
  const [origen, setOrigen] = useState<"" | "factura" | "ticket">("");

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      if (origen) p.set("origen", origen);
      const res = await apiFetch(`/api/reportes/libro-ventas-total?${p.toString()}`);
      const j = await res.json();
      if (!res.ok || j?.success === false) throw new Error(j?.error || "Error");
      setRows((j.data?.rows ?? []) as Row[]);
      setTotals((j.data?.totals ?? null) as Totals | null);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filas = useMemo(() => rows, [rows]);

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="mb-4 text-xs text-slate-500">
        <Link href="/reportes/libro-ventas" className="hover:underline">Reportes</Link> / Libro de Ventas Total
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Libro de Ventas Total</h1>
          <p className="text-sm text-slate-500 mt-1">
            Todas las ventas (facturadas + tickets de caja). Excluye anuladas. NO es reporte fiscal — usar Libro de Ventas para SET.
          </p>
        </div>
      </div>

      <div className="flex gap-2 items-end mb-4 flex-wrap bg-white border border-slate-200 rounded-lg p-3">
        <div>
          <label className="text-xs text-slate-600">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="block mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-600">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="block mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-600">Tipo</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value as "" | "factura" | "ticket")}
            className="block mt-1 px-3 py-2 border border-slate-300 rounded-md text-sm">
            <option value="">Todos</option>
            <option value="factura">Solo facturas</option>
            <option value="ticket">Solo tickets</option>
          </select>
        </div>
        <button onClick={cargar}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-sm font-medium">
          Aplicar
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs uppercase text-slate-500">Total ventas</div>
            <div className="text-xl font-bold text-slate-800 mt-1">{fmt(totals.total)}</div>
            <div className="text-[11px] text-slate-500">{totals.cantidad} operaciones</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs uppercase text-emerald-700">Facturadas</div>
            <div className="text-xl font-bold text-emerald-800 mt-1">{fmt(totals.total_facturadas)}</div>
            <div className="text-[11px] text-emerald-600">{totals.cantidad_facturadas} facturas</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs uppercase text-amber-700">Tickets</div>
            <div className="text-xl font-bold text-amber-800 mt-1">{fmt(totals.total_tickets)}</div>
            <div className="text-[11px] text-amber-600">{totals.cantidad_tickets} tickets</div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs uppercase text-sky-700">IVA (5% + 10%)</div>
            <div className="text-xl font-bold text-sky-800 mt-1">{fmt(totals.iva5 + totals.iva10)}</div>
            <div className="text-[11px] text-sky-600">5%: {fmt(totals.iva5)} · 10%: {fmt(totals.iva10)}</div>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {!loading && !error && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Fecha</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Tipo</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Número</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Cliente</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">RUC</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Cond.</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Pago</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Exento</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Grav. 5%</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">IVA 5%</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Grav. 10%</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">IVA 10%</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">Sin ventas en el período.</td></tr>}
              {filas.map((r, i) => (
                <tr key={r.venta_id + i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600">{fmtFecha(r.fecha)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${r.origen_tipo === "factura" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {r.origen}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.numero ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{r.cliente ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{r.ruc ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.condicion ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.metodo_pago ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.exento) > 0 ? fmt(r.exento) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.gravado5) > 0 ? fmt(r.gravado5) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(r.iva5) > 0 ? fmt(r.iva5) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.gravado10) > 0 ? fmt(r.gravado10) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(r.iva10) > 0 ? fmt(r.iva10) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
            {totals && filas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td colSpan={7} className="px-3 py-2 text-slate-700">Totales ({totals.cantidad} filas)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.exento)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.gravado5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(totals.iva5)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.gravado10)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmt(totals.iva10)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
