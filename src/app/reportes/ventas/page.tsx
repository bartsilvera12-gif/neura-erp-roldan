"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import MesSelector from "@/components/reportes/MesSelector";
import { getVentasReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import { useModoPersistido } from "@/components/ui/ToggleNutricionConsig";
import type { VentasReporte, TipoPrecioReporte, VentaTipoPrecioTotal } from "@/lib/reportes/types";

function formatGs(v: number) { return `Gs. ${Math.round(v).toLocaleString("es-PY")}`; }
function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return iso; }
}
function formatFechaHora(iso: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch { return iso; }
}
const TP: { key: TipoPrecioReporte; label: string; badge: string }[] = [
  { key: "minorista", label: "Minorista", badge: "bg-slate-100 text-slate-600" },
  { key: "mayorista", label: "Mayorista", badge: "bg-indigo-100 text-indigo-700" },
  { key: "distribuidor", label: "Distribuidor", badge: "bg-emerald-100 text-emerald-700" },
  { key: "costo", label: "Al costo", badge: "bg-amber-100 text-amber-700" },
];

type FiltroAnuladas = "todas" | "solo_activas" | "solo_anuladas";

const ORIGENES_NUTRICION = new Set(["normal", "MANUAL", "presupuesto"]);
const ORIGEN_CONSIG = "consignacion";

export default function VentasReportePage() {
  const [modo, setModo] = useModoPersistido("reportes-ventas.modo");
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<VentasReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtroAnuladas, setFiltroAnuladas] = useState<FiltroAnuladas>("todas");

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getVentasReporte(mes).then((d) => { if (!cancel) { setData(d); setCargando(false); } });
    return () => { cancel = true; };
  }, [mes]);

  // Filtro por origen client-side + RECÁLCULO de KPIs sobre el subconjunto
  // visible (sino los totales de arriba muestran el período completo aunque la
  // tabla esté filtrada).
  const dataFiltrada = useMemo<VentasReporte | null>(() => {
    if (!data) return null;
    const ventasVisibles = data.ventas.filter((v) => {
      const origen = ((v as unknown as { origen?: string }).origen ?? "").toString();
      if (modo === "consignataria") {
        if (origen) return origen === ORIGEN_CONSIG;
        // fallback: buscar "Consignación" en cliente/observaciones
        const obs = ((v as unknown as { observaciones?: string }).observaciones ?? "").toString().toLowerCase();
        const cli = (v.cliente ?? "").toString().toLowerCase();
        return obs.includes("consignaci") || cli.includes("consignaci");
      }
      // nutrición
      if (origen) return ORIGENES_NUTRICION.has(origen);
      return true;
    });

    // Números de control visibles → filtrar items detallados por esas ventas.
    const numControls = new Set(ventasVisibles.map((v) => v.numero_control));
    const itemsVisibles = (data.items ?? []).filter((it) => numControls.has(it.numero_control));

    // KPIs de plata solo sobre ventas activas (igual que el reporte base).
    const ventasActivas = ventasVisibles.filter((v) => v.estado !== "anulada");
    const totalVendido = ventasActivas.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const cantidadVentas = ventasActivas.length;
    const cantidadItems = itemsVisibles.length;
    const unidadesVendidas = itemsVisibles.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
    const ticketPromedio = cantidadVentas > 0 ? totalVendido / cantidadVentas : 0;

    const porTipoPrecio: Record<TipoPrecioReporte, VentaTipoPrecioTotal> = {
      minorista: { items: 0, total: 0 },
      mayorista: { items: 0, total: 0 },
      distribuidor: { items: 0, total: 0 },
      costo: { items: 0, total: 0 },
    };
    for (const it of itemsVisibles) {
      const tp: TipoPrecioReporte =
        it.tipo_precio === "mayorista" || it.tipo_precio === "distribuidor" || it.tipo_precio === "costo"
          ? it.tipo_precio
          : "minorista";
      porTipoPrecio[tp].items += 1;
      porTipoPrecio[tp].total += Number(it.total_linea) || 0;
    }

    return {
      ...data,
      ventas: ventasVisibles,
      items: itemsVisibles,
      totalVendido,
      cantidadVentas,
      cantidadItems,
      unidadesVendidas,
      ticketPromedio,
      porTipoPrecio,
    };
  }, [data, modo]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Ventas"
        description="Facturación y operaciones comerciales del período"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <MesSelector mes={mes} onChange={setMes} />
            <ExportExcelButton url={`/api/reportes/ventas/export?mes=${mes}&origen=${modo === "consignataria" ? "consignacion" : "nutricion"}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !dataFiltrada ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el reporte de ventas.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard compact label="Total vendido" value={formatGs(dataFiltrada.totalVendido)} accent />
            <StatCard compact label="Ventas" value={String(dataFiltrada.cantidadVentas)} hint={`${dataFiltrada.cantidadItems} ítems / líneas`} />
            <StatCard compact label="Ticket promedio" value={formatGs(dataFiltrada.ticketPromedio)} hint="por venta" />
            <StatCard compact label="Unidades vendidas" value={String(dataFiltrada.unidadesVendidas)} />
            <StatCard compact label="Ítems vendidos" value={String(dataFiltrada.cantidadItems)} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Por tipo de precio</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TP.map(({ key, label, badge }) => (
                <div key={key} className="rounded-xl border border-slate-200 p-4">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{label}</span>
                  <p className="mt-2 text-lg font-bold tabular-nums text-slate-800">{formatGs(dataFiltrada.porTipoPrecio[key].total)}</p>
                  <p className="text-xs text-slate-400">{dataFiltrada.porTipoPrecio[key].items} {dataFiltrada.porTipoPrecio[key].items === 1 ? "ítem" : "ítems"}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-800">Ventas del mes</h2>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                {(
                  [
                    { key: "todas", label: "Todas" },
                    { key: "solo_activas", label: "Solo activas" },
                    { key: "solo_anuladas", label: "Solo anuladas" },
                  ] as { key: FiltroAnuladas; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFiltroAnuladas(opt.key)}
                    className={`rounded-md px-3 py-1.5 transition-colors ${
                      filtroAnuladas === opt.key
                        ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const ventasFiltradas = dataFiltrada.ventas.filter((v) => {
                if (filtroAnuladas === "solo_activas") return v.estado !== "anulada";
                if (filtroAnuladas === "solo_anuladas") return v.estado === "anulada";
                return true;
              });
              if (dataFiltrada.ventas.length === 0) {
                return <p className="text-sm text-slate-400">
                  {modo === "consignataria"
                    ? "No hay ventas de consignación en el período."
                    : "No hay ventas en el período."}
                </p>;
              }
              if (ventasFiltradas.length === 0) {
                return (
                  <p className="text-sm text-slate-400">
                    {filtroAnuladas === "solo_anuladas" ? "No hay ventas anuladas en el período." : "No hay ventas activas en el período."}
                  </p>
                );
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b text-slate-500">
                        <th className="py-2.5 pr-4 font-medium">Fecha</th>
                        <th className="py-2.5 pr-4 font-medium">N° Venta</th>
                        <th className="py-2.5 pr-4 font-medium">Cliente</th>
                        <th className="py-2.5 pr-4 font-medium">Pago</th>
                        <th className="py-2.5 pr-4 font-medium text-right">Ítems</th>
                        <th className="py-2.5 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventasFiltradas.map((v) => {
                        const anulada = v.estado === "anulada";
                        return (
                          <tr key={v.id} className={`border-b border-slate-100 last:border-0 ${anulada ? "text-slate-400" : ""}`}>
                            <td className="py-3 pr-4 text-xs tabular-nums">{formatFecha(v.fecha)}</td>
                            <td className={`py-3 pr-4 font-mono text-xs ${anulada ? "line-through" : "text-slate-500"}`}>{v.numero_control}</td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <span className={anulada ? "line-through" : "text-slate-700"}>{v.cliente ?? "—"}</span>
                                {anulada && (
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200">Anulada</span>
                                )}
                              </div>
                              {anulada && (
                                <div className="mt-1 text-[11px] text-rose-700/80 leading-snug">
                                  {v.productos_resumen && <div><span className="font-semibold">Productos:</span> {v.productos_resumen}</div>}
                                  {v.anulacion_motivo && <div><span className="font-semibold">Motivo:</span> {v.anulacion_motivo}</div>}
                                  <div className="text-slate-500">
                                    {v.anulada_at ? formatFechaHora(v.anulada_at) : "—"}
                                    {v.anulada_por_email ? ` · ${v.anulada_por_email}` : ""}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4 capitalize">{v.metodo_pago ?? "—"}</td>
                            <td className="py-3 pr-4 text-right tabular-nums">{v.items_count}</td>
                            <td className={`py-3 text-right tabular-nums font-semibold ${anulada ? "line-through" : "text-slate-800"}`}>{formatGs(v.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Total por producto</h2>
            {dataFiltrada.porProducto.length === 0 ? (
              <p className="text-sm text-slate-400">Sin datos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Producto</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Cantidad</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataFiltrada.porProducto.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{p.producto_nombre}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{p.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
