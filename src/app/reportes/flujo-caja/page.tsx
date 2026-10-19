"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import PeriodoSelector, { type SeleccionPeriodo } from "@/components/reportes/PeriodoSelector";
import { getFlujoCajaReporte } from "@/lib/reportes/storage";
import type { FlujoCajaReporte, MovimientoCaja } from "@/lib/reportes/flujo-caja-types";

function formatGs(v: number) {
  const s = `Gs. ${Math.abs(Math.round(v)).toLocaleString("es-PY")}`;
  return v < 0 ? `- ${s}` : s;
}
function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
function metodoLabel(m: string | null) {
  if (!m) return "—";
  const v = m.toLowerCase();
  if (v === "efectivo") return "Efectivo";
  if (v === "tarjeta") return "Tarjeta";
  if (v === "transferencia") return "Transfer.";
  return m;
}

export default function FlujoCajaPage() {
  const [sel, setSel] = useState<SeleccionPeriodo | null>(null);
  const [data, setData] = useState<FlujoCajaReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  const onPeriodo = useCallback((s: SeleccionPeriodo) => setSel(s), []);

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setCargando(true);
    getFlujoCajaReporte(sel.tipo, { ref: sel.ref, desde: sel.desde, hasta: sel.hasta }).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [sel]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Flujo de caja"
        description="Dinero realmente cobrado y pagado en el período (independiente del resultado contable)"
        backHref="/reportes"
        backLabel="Reportes"
        actions={<PeriodoSelector onChange={onPeriodo} />}
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el flujo de caja.
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">{data.periodoLabel}</span>
          </div>

          {/* Waterfall de caja */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label="Saldo inicial" value={formatGs(data.saldoInicial)} hint="acumulado previo del sistema" />
            <StatCard compact label="Entradas" value={formatGs(data.totalEntradas)} hint={`Contado ${formatGs(data.entradaContado)} · Cobros ${formatGs(data.entradaCobros)}`} />
            <StatCard compact label="Salidas" value={formatGs(data.totalSalidas)} hint={`Compras ${formatGs(data.salidaCompras)} · Gastos ${formatGs(data.salidaGastos)}`} />
            <StatCard compact accent label="Saldo final" value={formatGs(data.saldoFinal)} hint="inicial + entradas − salidas" />
          </div>

          {/* Detalle de movimientos */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Movimientos de caja del período</h2>
              <p className="text-xs text-slate-400 mt-0.5">Entradas cobradas y salidas pagadas (máx. 500)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2.5 px-4 font-medium">Fecha</th>
                    <th className="py-2.5 px-4 font-medium">Tipo</th>
                    <th className="py-2.5 px-4 font-medium">Referencia / Detalle</th>
                    <th className="py-2.5 px-4 font-medium">Método</th>
                    <th className="py-2.5 px-4 font-medium text-right">Entrada</th>
                    <th className="py-2.5 px-4 font-medium text-right">Salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.movimientos.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-400">Sin movimientos de caja en el período.</td></tr>
                  ) : data.movimientos.map((m, i) => <FilaMov key={i} m={m} />)}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            <strong>Entradas</strong> = ventas al contado (día de la venta) + cobros de cuentas a crédito (día del cobro).
            <strong> Salidas</strong> = compras marcadas pagadas (día del pago) + gastos (su fecha). El <strong>saldo inicial</strong>{" "}
            es el acumulado del sistema antes del período (no incluye efectivo anterior al sistema). Es un reporte de caja, distinto
            del resultado contable (que usa el costo de lo vendido, no los pagos).
          </p>
        </>
      )}
    </div>
  );
}

function FilaMov({ m }: { m: MovimientoCaja }) {
  const badge =
    m.tipo === "Cobro" || m.tipo === "Venta contado" ? "bg-emerald-50 text-emerald-700"
    : "bg-red-50 text-red-700";
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{formatFechaHora(m.fecha)}</td>
      <td className="py-2.5 px-4"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>{m.tipo}</span></td>
      <td className="py-2.5 px-4 text-slate-600">
        {m.referencia && <span className="font-mono text-xs text-slate-500">{m.referencia}</span>}
        {m.referencia && m.descripcion ? " · " : ""}
        {m.descripcion}
      </td>
      <td className="py-2.5 px-4 text-slate-500">{metodoLabel(m.metodo)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-emerald-700">{m.entrada > 0 ? formatGs(m.entrada) : "—"}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-red-600">{m.salida > 0 ? formatGs(m.salida) : "—"}</td>
    </tr>
  );
}
