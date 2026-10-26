"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import PeriodoSelector, { type SeleccionPeriodo } from "@/components/reportes/PeriodoSelector";
import { getRentabilidadReporte } from "@/lib/reportes/storage";
import type { RentabilidadReporte, RentabilidadRow, AgruparRentabilidad } from "@/lib/reportes/rentabilidad-types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatPct(v: number) {
  return `${v.toFixed(1).replace(".", ",")}%`;
}
function formatNum(v: number) {
  return v.toLocaleString("es-PY", { maximumFractionDigits: 2 });
}

type SortKey = "nombre" | "unidades" | "facturacion" | "costo" | "ganancia" | "margen" | "participacion";

export default function RentabilidadReportePage() {
  const [sel, setSel] = useState<SeleccionPeriodo | null>(null);
  const [agrupar, setAgrupar] = useState<AgruparRentabilidad>("producto");
  const [data, setData] = useState<RentabilidadReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("ganancia");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const onPeriodo = useCallback((s: SeleccionPeriodo) => setSel(s), []);

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setCargando(true);
    getRentabilidadReporte(sel.tipo, agrupar, { ref: sel.ref, desde: sel.desde, hasta: sel.hasta }).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [sel, agrupar]);

  const filasOrdenadas = useMemo(() => {
    if (!data) return [];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...data.filas].sort((a, b) => {
      if (sortKey === "nombre") return dir * a.nombre.localeCompare(b.nombre);
      return dir * ((a[sortKey] as number) - (b[sortKey] as number));
    });
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "nombre" ? "asc" : "desc"); }
  }

  const esProducto = agrupar === "producto";
  const margenTotal = data && data.totalFacturacion > 0 ? (data.totalGanancia / data.totalFacturacion) * 100 : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Rentabilidad"
        description="Ganancia y margen por producto y por rubro"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <button onClick={() => setAgrupar("producto")} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${esProducto ? "bg-[#3F8E91] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}>Por producto</button>
              <button onClick={() => setAgrupar("categoria")} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${!esProducto ? "bg-[#3F8E91] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}>Por rubro</button>
            </div>
            <PeriodoSelector onChange={onPeriodo} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el reporte de rentabilidad.
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">{data.periodoLabel}</span>
            {" · "}{esProducto ? "por producto" : "por rubro"}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label="Facturación (sin IVA)" value={formatGs(data.totalFacturacion)} accent />
            <StatCard compact label="Costo de lo vendido" value={formatGs(data.totalCosto)} />
            <StatCard compact accent label="Ganancia" value={formatGs(data.totalGanancia)} />
            <StatCard compact label="Margen" value={formatPct(margenTotal)} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <Th label={esProducto ? "Producto" : "Rubro"} onClick={() => toggleSort("nombre")} active={sortKey === "nombre"} />
                    <Th label="Unidades" right onClick={() => toggleSort("unidades")} active={sortKey === "unidades"} />
                    <Th label="Facturación" right onClick={() => toggleSort("facturacion")} active={sortKey === "facturacion"} />
                    <Th label="Costo" right onClick={() => toggleSort("costo")} active={sortKey === "costo"} />
                    <Th label="Ganancia" right onClick={() => toggleSort("ganancia")} active={sortKey === "ganancia"} />
                    <Th label="Margen %" right onClick={() => toggleSort("margen")} active={sortKey === "margen"} />
                    <Th label="Partic." right onClick={() => toggleSort("participacion")} active={sortKey === "participacion"} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filasOrdenadas.length === 0 ? (
                    <tr><td colSpan={7} className="py-6 text-center text-slate-400">No hay ventas en el período.</td></tr>
                  ) : filasOrdenadas.map((f) => <FilaRent key={f.id} f={f} esProducto={esProducto} />)}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            Facturación sin IVA (subtotal de las líneas vendidas); costo = CMV sin IVA (costo de cada producto al
            momento de la venta). <strong>Participación</strong> = qué % de la ganancia total aporta cada
            {esProducto ? " producto" : " rubro"}. Excluye ventas anuladas y de consignación.
          </p>
        </>
      )}
    </div>
  );
}

function Th({ label, right, onClick, active }: { label: string; right?: boolean; onClick: () => void; active: boolean }) {
  return (
    <th className={`py-2.5 px-4 font-medium select-none cursor-pointer hover:text-slate-600 ${right ? "text-right" : ""} ${active ? "text-slate-700" : ""}`} onClick={onClick}>
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {label}<ArrowUpDown size={12} className={active ? "text-[#3F8E91]" : "text-slate-300"} />
      </span>
    </th>
  );
}

function FilaRent({ f, esProducto }: { f: RentabilidadRow; esProducto: boolean }) {
  const gananciaColor = f.ganancia > 0 ? "text-slate-900" : f.ganancia < 0 ? "text-red-600" : "text-slate-500";
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="py-2.5 px-4">
        <div className="font-medium text-slate-700">{f.nombre}</div>
        {esProducto && (f.sku || f.categoria) && (
          <div className="text-xs text-slate-400">{[f.sku, f.categoria].filter(Boolean).join(" · ")}</div>
        )}
      </td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-600">{formatNum(f.unidades)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-600">{formatGs(f.facturacion)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-500">{formatGs(f.costo)}</td>
      <td className={`py-2.5 px-4 text-right tabular-nums font-semibold ${gananciaColor}`}>{formatGs(f.ganancia)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-600">{formatPct(f.margen)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-500">{formatPct(f.participacion)}</td>
    </tr>
  );
}
