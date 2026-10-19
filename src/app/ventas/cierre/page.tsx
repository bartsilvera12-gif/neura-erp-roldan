"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getVentas } from "@/lib/ventas/storage";
import type { Venta } from "@/lib/ventas/types";
import { hoyAsuncionYmd } from "@/lib/fechas/asuncion-bounds";

const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

/** Una unidad de negocio (área) con sus totales y desglose contado/crédito. */
interface AreaTot {
  label:    string;
  total:    number;
  cantidad: number;
  contado:  number;
  credito:  number;
}

interface CierreData {
  areas:    AreaTot[];
  total:    number;
  cantidad: number;
  contado:  number;
  credito:  number;
  pagos:    { efectivo: number; tarjeta: number; transferencia: number; otros: number };
}

function calcularCierre(ventas: Venta[], desde: string, hasta: string): CierreData {
  const enRango = ventas.filter((v) => {
    if (v.estado === "anulada") return false;
    const dia = (v.fecha ?? "").slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    return true;
  });

  // Roldán e Hijos: sólo "Ventas" (unidades Nutrición/Consignataria heredadas de Reserva no aplican).
  const mk = (label: string): AreaTot => ({ label, total: 0, cantidad: 0, contado: 0, credito: 0 });
  const nutricion     = mk("Ventas");
  const consignataria = mk("Consignataria");
  const pagos = { efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0 };
  let total = 0, cantidad = 0, contado = 0, credito = 0;

  for (const v of enRango) {
    const area = v.origen === "consignacion" ? consignataria : nutricion;
    const esCredito = v.tipo_venta === "CREDITO";
    area.total    += v.total;
    area.cantidad += 1;
    total    += v.total;
    cantidad += 1;
    if (esCredito) { area.credito += v.total; credito += v.total; }
    else           { area.contado += v.total; contado += v.total; }

    // Forma de pago (solo aporta al efectivo físico lo cobrado al contado).
    if (!esCredito) {
      switch (v.metodo_pago) {
        case "efectivo":      pagos.efectivo += v.total; break;
        case "tarjeta":       pagos.tarjeta += v.total; break;
        case "transferencia": pagos.transferencia += v.total; break;
        default:              pagos.otros += v.total; break;
      }
    }
  }

  return { areas: [nutricion], total, cantidad, contado, credito, pagos };
}

export default function CierreCajaPage() {
  const [todas, setTodas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const hoy = hoyAsuncionYmd();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);

  useEffect(() => {
    getVentas()
      .then((d) => setTodas(d))
      .catch(() => setTodas([]))
      .finally(() => setCargando(false));
  }, []);

  // Marca el <html> para que globals.css oculte header/sidebar/nav móvil al imprimir,
  // así el comprobante sale limpio y no como captura de pantalla.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("cierre-caja-print-page");
    return () => el.classList.remove("cierre-caja-print-page");
  }, []);

  const cierre = useMemo(() => calcularCierre(todas, desde, hasta), [todas, desde, hasta]);

  const rangoLabel = desde === hasta
    ? new Date(`${desde}T12:00:00`).toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${desde} → ${hasta}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Barra superior (no se imprime) */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/ventas" className="text-xs font-medium text-[#3F8E91] hover:underline">← Volver a Caja</Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Cierre de Caja</h1>
          <p className="mt-0.5 text-xs text-slate-500">Discriminado por unidad de negocio</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F8E91]"
        >
          🖨 Imprimir / PDF
        </button>
      </div>

      {/* Selector de rango (no se imprime) */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Desde</label>
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Hasta</label>
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        </div>
        <button type="button" onClick={() => { setDesde(hoy); setHasta(hoy); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
          Hoy
        </button>
      </div>

      {/* Comprobante de cierre */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
        <div className="mb-4 border-b border-slate-100 pb-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Cierre de Caja</p>
          <p className="mt-1 text-sm font-medium capitalize text-slate-700">{rangoLabel}</p>
        </div>

        {cargando ? (
          <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : cierre.cantidad === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No hay ventas en el período seleccionado.</p>
        ) : (
          <>
            {/* Desglose por área */}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-semibold">Área</th>
                  <th className="pb-2 text-right font-semibold">Contado</th>
                  <th className="pb-2 text-right font-semibold">Crédito</th>
                  <th className="pb-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {cierre.areas.map((a) => (
                  <tr key={a.label} className="border-t border-slate-100">
                    <td className="py-2.5">
                      <span className="font-medium text-slate-700">{a.label}</span>
                      <span className="ml-2 text-[11px] text-slate-400">
                        {a.cantidad} {a.cantidad === 1 ? "orden" : "órdenes"}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{gs(a.contado)}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{gs(a.credito)}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-slate-800">{gs(a.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#4FAEB2]/40">
                  <td className="pt-3">
                    <span className="font-bold text-[#3F8E91]">TOTAL CAJA</span>
                    <span className="ml-2 text-[11px] text-slate-400">
                      {cierre.cantidad} {cierre.cantidad === 1 ? "orden" : "órdenes"}
                    </span>
                  </td>
                  <td className="pt-3 text-right tabular-nums text-slate-600">{gs(cierre.contado)}</td>
                  <td className="pt-3 text-right tabular-nums text-slate-600">{gs(cierre.credito)}</td>
                  <td className="pt-3 text-right text-lg font-bold tabular-nums text-[#3F8E91]">{gs(cierre.total)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Forma de pago (contado) */}
            <div className="mt-7 border-t border-slate-100 pt-5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Cobros al contado por forma de pago
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <PagoStat label="Efectivo"        value={cierre.pagos.efectivo} />
                <PagoStat label="Tarjeta"         value={cierre.pagos.tarjeta} />
                <PagoStat label="Transferencia"   value={cierre.pagos.transferencia} />
                <PagoStat label="Sin especificar" value={cierre.pagos.otros} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PagoStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 tabular-nums text-[15px] font-semibold text-slate-700">{gs(value)}</div>
    </div>
  );
}
