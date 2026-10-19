"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import PeriodoSelector, { type SeleccionPeriodo } from "@/components/reportes/PeriodoSelector";
import { getTesoreriaReporte } from "@/lib/reportes/storage";
import type { TesoreriaReporte } from "@/lib/reportes/tesoreria-types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export default function TesoreriaPage() {
  const [sel, setSel] = useState<SeleccionPeriodo | null>(null);
  const [data, setData] = useState<TesoreriaReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  const onPeriodo = useCallback((s: SeleccionPeriodo) => setSel(s), []);

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setCargando(true);
    getTesoreriaReporte(sel.tipo, { ref: sel.ref, desde: sel.desde, hasta: sel.hasta }).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [sel]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Tesorería por cuenta"
        description="Movimiento de dinero por banco, cuenta, POS y efectivo"
        backHref="/reportes"
        backLabel="Reportes"
        actions={<PeriodoSelector onChange={onPeriodo} />}
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar la tesorería.
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">{data.periodoLabel}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard compact accent label="Total entradas" value={formatGs(data.totalEntradas)} hint="todas las cuentas" />
            <StatCard compact label="Pendiente de conciliar" value={formatGs(data.totalPendienteConciliar)} hint="entradas bancarias sin conciliar" />
            <StatCard compact label="Cuentas con movimiento" value={String(data.filas.length)} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2.5 px-4 font-medium">Banco / Cuenta</th>
                    <th className="py-2.5 px-4 font-medium text-right">Entradas</th>
                    <th className="py-2.5 px-4 font-medium text-right">Salidas</th>
                    <th className="py-2.5 px-4 font-medium text-right">Saldo sistema</th>
                    <th className="py-2.5 px-4 font-medium text-right">Pendiente de conciliar</th>
                    <th className="py-2.5 px-4 font-medium text-right">Movs.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.filas.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-400">Sin movimientos en el período.</td></tr>
                  ) : data.filas.map((f) => (
                    <tr key={f.entidad} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-4 font-medium text-slate-700">{f.entidad}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-emerald-700">{formatGs(f.entradas)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-slate-400">{f.salidas > 0 ? formatGs(f.salidas) : "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{formatGs(f.saldoSistema)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-amber-600">{f.pendienteConciliar > 0 ? formatGs(f.pendienteConciliar) : "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-slate-500">{f.cantidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            Entradas agrupadas por la entidad (banco/cuenta/POS) elegida en cada cobro; el efectivo va como
            <strong> Efectivo (caja)</strong>. Las <strong>salidas por cuenta aún no se muestran</strong>: compras y gastos
            todavía no guardan a qué cuenta se pagaron — cuando agreguemos ese campo, esta columna se completa y el saldo
            por cuenta será exacto. <strong>Pendiente de conciliar</strong> = entradas bancarias que todavía no fueron
            aprobadas en Conciliación.
          </p>
        </>
      )}
    </div>
  );
}
