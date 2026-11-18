"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AccionesTabla from "@/components/ui/AccionesTabla";
import type { VentasAnual } from "@/lib/reportes/server/ventas-anual-pg";

/**
 * Historial de ventas (antes «Ventas», el reporte del mes).
 *
 * Pedido del cliente: que sea por AÑO, con los datos completos y un gráfico.
 * El listado de cada venta, con rango de fechas y filtros, es la pantalla
 * Ventas (/reportes/historial-ventas); cada mes de acá lleva ahí.
 */

const GraficoVentasAnual = dynamic(() => import("@/components/reportes/GraficoVentasAnual"), {
  ssr: false,
  loading: () => <div className="h-full" />,
});

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const gs = (n: number | undefined) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%`);
const TP_LABEL: Record<string, string> = { minorista: "Minorista", mayorista: "Mayorista", distribuidor: "Distribuidor", costo: "Al costo" };

function anioPy(): number {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCFullYear();
}
function finDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function HistorialVentasAnualPage() {
  const [anio, setAnio] = useState(anioPy());
  const [data, setData] = useState<VentasAnual | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetchWithSupabaseSession(`/api/reportes/ventas-anual?anio=${anio}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !j?.success) { setError(j?.error ?? `No se pudo cargar (${r.status}).`); setData(null); return; }
        setData(j.data as VentasAnual);
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "Error de red."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [anio]);

  const conCostos = data?.conCostos === true;
  const grafico = useMemo(
    () => (data?.meses ?? []).map((m) => ({
      mes: MESES[m.mes - 1].slice(0, 3),
      contado: m.contado,
      credito: m.credito,
      ...(conCostos ? { utilidad: m.utilidad ?? 0 } : {}),
    })),
    [data, conCostos]
  );

  const columnas = [
    "Mes", "Ventas", "Anuladas", "Contado", "Crédito", "Descuentos", "Total", "Ticket promedio", "Unidades",
    ...(conCostos ? ["Costo de venta", "Utilidad", "Margen %"] : []),
  ];
  const filas = (data?.meses ?? []).map((m) => [
    MESES[m.mes - 1], m.ventas, m.anuladas, Math.round(m.contado), Math.round(m.credito), Math.round(m.descuento),
    Math.round(m.total), Math.round(m.ticket), m.unidades,
    ...(conCostos ? [Math.round(m.costo ?? 0), Math.round(m.utilidad ?? 0), m.margen_pct == null ? "" : Math.round(m.margen_pct * 10) / 10] : []),
  ]);
  const t = data?.totales;
  const esteAnio = anioPy();

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> /{" "}
            <span className="font-semibold text-slate-700">Historial de ventas</span>
          </nav>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Historial de ventas</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            El año completo, mes por mes. Para ver venta por venta, tocá un mes o andá a{" "}
            <Link href="/reportes/historial-ventas" className="underline hover:text-[#4FAEB2]">Ventas</Link>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
            <button type="button" onClick={() => setAnio((a) => a - 1)} className="px-2 py-2 text-slate-500 hover:text-slate-800" aria-label="Año anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[4rem] text-center text-sm font-semibold tabular-nums text-slate-800">{anio}</span>
            <button type="button" onClick={() => setAnio((a) => Math.min(esteAnio, a + 1))} disabled={anio >= esteAnio}
              className="px-2 py-2 text-slate-500 hover:text-slate-800 disabled:opacity-30" aria-label="Año siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <AccionesTabla
            titulo={`Historial de ventas ${anio}`}
            archivo={`historial-ventas-${anio}`}
            subtitulo={`Año ${anio}, mes por mes`}
            columnas={columnas}
            filas={filas}
            sumar={conCostos ? [1, 2, 3, 4, 5, 6, 8, 9, 10] : [1, 2, 3, 4, 5, 6, 8]}
          />
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {cargando ? (
        <p className="animate-pulse text-sm text-slate-500">Cargando el año…</p>
      ) : data && t ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {[
              { l: "Total vendido", v: `Gs. ${gs(t.total)}`, fuerte: true },
              { l: "Ventas", v: gs(t.ventas), h: t.anuladas ? `${t.anuladas} anuladas aparte` : undefined },
              { l: "Contado · Crédito", v: `${gs(t.contado)} · ${gs(t.credito)}` },
              { l: "Ticket promedio", v: `Gs. ${gs(t.ticket)}` },
              { l: "Descuentos", v: `Gs. ${gs(t.descuento)}` },
              ...(conCostos ? [{ l: "Utilidad", v: `Gs. ${gs(t.utilidad)}`, h: `Margen ${pct(t.margen_pct)}`, verde: true }] : [{ l: "Unidades", v: gs(t.unidades) }]),
            ].map((k) => (
              <div key={k.l} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-medium text-slate-500">{k.l}</p>
                <p className={`mt-1 text-base font-bold tabular-nums ${"verde" in k && k.verde ? "text-emerald-700" : "fuerte" in k && k.fuerte ? "text-[#3F8E91]" : "text-slate-800"}`}>{k.v}</p>
                {"h" in k && k.h && <p className="text-[11px] text-slate-400">{k.h}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Mes por mes</h2>
            <div className="h-[300px]">
              <GraficoVentasAnual data={grafico} conUtilidad={conCostos} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Mes</th>
                  <th className="px-4 py-3 text-right font-semibold">Ventas</th>
                  <th className="px-4 py-3 text-right font-semibold">Contado</th>
                  <th className="px-4 py-3 text-right font-semibold">Crédito</th>
                  <th className="px-4 py-3 text-right font-semibold">Descuentos</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-right font-semibold">Ticket prom.</th>
                  {conCostos && (
                    <>
                      <th className="px-4 py-3 text-right font-semibold">Costo de venta</th>
                      <th className="px-4 py-3 text-right font-semibold" title="Misma fórmula que el punto de equilibrio, con el costo de hoy">Utilidad</th>
                      <th className="px-4 py-3 text-right font-semibold">Margen</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.meses.map((m) => (
                  <tr key={m.mes} className={m.ventas === 0 ? "text-slate-300" : "hover:bg-slate-50"}>
                    <td className="px-4 py-2.5">
                      {m.ventas > 0 ? (
                        <Link
                          href={`/reportes/historial-ventas?desde=${anio}-${String(m.mes).padStart(2, "0")}-01&hasta=${finDeMes(anio, m.mes)}`}
                          className="font-medium text-slate-800 hover:text-[#3F8E91] hover:underline"
                        >
                          {MESES[m.mes - 1]}
                        </Link>
                      ) : MESES[m.mes - 1]}
                      {m.anuladas > 0 && <span className="ml-2 text-[11px] text-rose-500">{m.anuladas} anul.</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.ventas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.contado)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.credito)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.descuento)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{gs(m.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.ticket)}</td>
                    {conCostos && (
                      <>
                        <td className="px-4 py-2.5 text-right tabular-nums">{gs(m.costo)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(m.utilidad ?? 0) < 0 ? "text-rose-600" : m.ventas ? "text-emerald-700" : ""}`}>{gs(m.utilidad)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{m.ventas ? pct(m.margen_pct) : "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold">
                <tr>
                  <td className="px-4 py-3">Total {anio}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.ventas)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.contado)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.credito)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.descuento)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{gs(t.ticket)}</td>
                  {conCostos && (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums">{gs(t.costo)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{gs(t.utilidad)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(t.margen_pct)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Por vendedor</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1.5 text-left font-semibold">Vendedor</th>
                    <th className="py-1.5 text-right font-semibold">Ventas</th>
                    <th className="py-1.5 text-right font-semibold">Total</th>
                    {conCostos && <th className="py-1.5 text-right font-semibold">Utilidad</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.porVendedor.map((v) => (
                    <tr key={v.vendedor}>
                      <td className="py-1.5 text-slate-700">{v.vendedor}</td>
                      <td className="py-1.5 text-right tabular-nums">{gs(v.ventas)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{gs(v.total)}</td>
                      {conCostos && <td className="py-1.5 text-right tabular-nums text-emerald-700">{gs(v.utilidad)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-800">Por tipo de precio</h2>
              <div className="flex flex-wrap gap-3">
                {data.porTipoPrecio.map((r) => (
                  <div key={r.tipo_precio} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-[11px] text-slate-500">{TP_LABEL[r.tipo_precio] ?? r.tipo_precio}</p>
                    <p className="text-sm font-bold tabular-nums text-slate-800">Gs. {gs(r.total)}</p>
                    <p className="text-[11px] text-slate-400">{gs(r.items)} ítems</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Los 50 productos que más facturaron</h2>
              <div className="max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-xs text-slate-500">
                    <tr>
                      <th className="py-1.5 text-left font-semibold">Producto</th>
                      <th className="py-1.5 text-right font-semibold">Cant.</th>
                      <th className="py-1.5 text-right font-semibold">Total</th>
                      {conCostos && <th className="py-1.5 text-right font-semibold">Utilidad</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.porProducto.map((p, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-2 text-slate-700">{p.producto_nombre}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.cantidad.toLocaleString("es-PY", { maximumFractionDigits: 2 })}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums">{gs(p.total)}</td>
                        {conCostos && <td className={`py-1.5 text-right tabular-nums ${(p.utilidad ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>{gs(p.utilidad)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
