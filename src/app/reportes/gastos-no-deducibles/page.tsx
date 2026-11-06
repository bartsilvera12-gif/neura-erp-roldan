"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { Metrica, FilaDeMetricas, type TonoMetrica } from "@/components/ui/Metrica";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AlertTriangle, FileWarning, Printer } from "lucide-react";

/**
 * Gastos sin factura o no deducibles.
 *
 * ── PARA QUÉ SIRVE ─────────────────────────────────────────────────────────
 *   Separa lo que no se puede usar en la declaración. Y dentro de eso, lo que
 *   TODAVÍA se puede arreglar: el gasto al que le falta el timbrado o el RUC
 *   se corrige pidiéndole el dato al proveedor. El que se pagó sin factura ya
 *   no tiene vuelta, y lo único que queda es saber cuánto fue.
 */

type Clase = "deducible" | "factura_incompleta" | "sin_factura";

type Gasto = {
  id: string; fecha: string; categoria: string | null; descripcion: string | null;
  beneficiario: string | null; monto: number; monto_iva: number | null;
  numero_factura: string | null; nro_timbrado: string | null; proveedor_ruc: string | null;
  clase: Clase; faltan: string[];
};

type Resp = {
  desde: string; hasta: string;
  resumen: {
    por_clase: { clase: Clase; cantidad: number; monto: number; iva: number }[];
    por_categoria: { categoria: string; cantidad: number; monto: number }[];
    total_gastos: number; monto_total: number;
    no_deducibles: number; monto_no_deducible: number;
    iva_no_acreditable: number; porcentaje_no_deducible: number | null;
  };
  gastos: Gasto[];
  reclamables: Gasto[];
  egresos_caja: { total: number; sin_comprobante: number; monto_sin_comprobante: number } | null;
  columnas_completas: boolean;
  aviso: string | null;
};

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const fmt = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}` : iso;
};

const ETIQUETA: Record<Clase, string> = {
  sin_factura: "Sin factura",
  factura_incompleta: "Factura incompleta",
  deducible: "Con factura completa",
};

/** El tono de cada clase en las tarjetas de arriba. */
const TONO: Record<Clase, TonoMetrica> = {
  sin_factura: "alerta",
  factura_incompleta: "pendiente",
  deducible: "bien",
};

const COLOR: Record<Clase, string> = {
  sin_factura: "bg-rose-50 text-rose-800 ring-rose-200",
  factura_incompleta: "bg-amber-50 text-amber-800 ring-amber-200",
  deducible: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

/** El primer día del mes en curso, en hora de Paraguay. */
function mesEnCurso(): { desde: string; hasta: string } {
  const hoy = new Date(Date.now() - 3 * 3_600_000);
  const a = hoy.getUTCFullYear();
  const m = String(hoy.getUTCMonth() + 1).padStart(2, "0");
  return { desde: `${a}-${m}-01`, hasta: hoy.toISOString().slice(0, 10) };
}

export default function GastosNoDeduciblesPage() {
  const inicial = mesEnCurso();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [data, setData] = useState<Resp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const p = new URLSearchParams({ desde, hasta });
      const r = await fetchWithSupabaseSession(`/api/gastos/no-deducibles?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo armar el reporte.");
      setData(j.data as Resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  const r = data?.resumen;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Reportes"
        title="Gastos sin factura o no deducibles"
        description="Lo que no se puede usar en la declaración, y lo que todavía se puede reclamar"
        actions={
          <button
            type="button" onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 print:hidden"
          >
            <Printer className="h-4 w-4" /> Imprimir
          </button>
        }
      />

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 print:hidden">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Desde</span>
          <input
            type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-500">Hasta</span>
          <input
            type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button" onClick={() => void cargar()} disabled={cargando}
          className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
        >
          {cargando ? "Buscando…" : "Ver"}
        </button>
      </div>

      {data?.aviso && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{data.aviso}</p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : !r ? null : (
        <>
          {/* ── Los números de arriba ──────────────────────────────────── */}
          <FilaDeMetricas>
            {(["sin_factura", "factura_incompleta", "deducible"] as const).map((c) => {
              const x = r.por_clase.find((k) => k.clase === c)!;
              return (
                <Metrica
                  key={c}
                  etiqueta={ETIQUETA[c]}
                  tono={TONO[c]}
                  valor={gs(x.monto)}
                  detalle={`${x.cantidad} ${x.cantidad === 1 ? "gasto" : "gastos"}`}
                />
              );
            })}
            <Metrica
              etiqueta="IVA que no se puede acreditar"
              valor={gs(r.iva_no_acreditable)}
              detalle={
                r.porcentaje_no_deducible == null
                  ? "sin gastos en el período"
                  : `${r.porcentaje_no_deducible.toFixed(1)}% del gasto del período no sirve`
              }
            />
          </FilaDeMetricas>

          {/* ── Lo reclamable, que es la parte accionable ──────────────── */}
          {r.por_clase.find((k) => k.clase === "factura_incompleta")!.cantidad > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" /> Esto todavía se puede arreglar
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Estos gastos tienen la factura cargada pero les falta un dato, así que hoy no sirven.
                Al proveedor se le puede pedir: con el dato cargado, el gasto sale solo de este reporte.
              </p>
              <ul className="mt-2 space-y-1">
                {data!.reclamables.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-amber-900">
                    <span className="font-semibold tabular-nums">{gs(g.monto)}</span>
                    <span>·</span>
                    <span>{g.beneficiario || g.descripcion || g.categoria || "—"}</span>
                    <span className="font-mono text-[11px] opacity-70">{g.numero_factura}</span>
                    <span className="rounded bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-semibold">
                      falta {g.faltan.join(" y ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── El listado ─────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <FileWarning className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-800">
                {r.no_deducibles} de {r.total_gastos} gastos del período no sirven
              </span>
              <span className="text-xs text-slate-500">{gs(r.monto_no_deducible)} de {gs(r.monto_total)}</span>
            </div>

            {data!.gastos.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                {r.total_gastos === 0
                  ? "No hay gastos cargados en el período."
                  : "Todos los gastos del período tienen factura, timbrado y RUC. Nada que reclamar."}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                    <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                    <th className="px-3 py-2 text-left font-semibold">Beneficiario / detalle</th>
                    <th className="px-3 py-2 text-left font-semibold">Factura</th>
                    <th className="px-3 py-2 text-left font-semibold">Qué le falta</th>
                    <th className="px-3 py-2 text-right font-semibold">Monto</th>
                    <th className="px-3 py-2 text-right font-semibold">IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.gastos.map((g) => (
                    <tr key={g.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{fmt(g.fecha)}</td>
                      <td className="px-3 py-1.5 text-slate-700">{g.categoria || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-800">
                        {g.beneficiario || g.descripcion || "—"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">
                        {g.numero_factura || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${COLOR[g.clase]}`}
                        >
                          {g.faltan.join(" y ")}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-900">{gs(g.monto)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {g.monto_iva ? gs(g.monto_iva) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                  <tr>
                    <td className="px-3 py-2 font-semibold text-slate-700" colSpan={5}>Total que no sirve</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {gs(r.monto_no_deducible)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-700">
                      {gs(r.iva_no_acreditable)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* ── Por categoría ──────────────────────────────────────────── */}
          {r.por_categoria.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                Dónde se concentra
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {r.por_categoria.map((c) => (
                    <tr key={c.categoria} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-slate-700">{c.categoria}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {c.cantidad} {c.cantidad === 1 ? "gasto" : "gastos"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-900">{gs(c.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Los egresos de caja, aparte ────────────────────────────── */}
          {data!.egresos_caja && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Egresos pagados desde caja</p>
              <p className="mt-1 text-xs text-slate-600">
                Van aparte a propósito: no son gastos del módulo. En el período hay{" "}
                <strong>{data!.egresos_caja.total}</strong>{" "}
                {data!.egresos_caja.total === 1 ? "egreso" : "egresos"}, de los cuales{" "}
                <strong>{data!.egresos_caja.sin_comprobante}</strong> no tienen comprobante adjunto
                {data!.egresos_caja.monto_sin_comprobante > 0
                  ? ` (${gs(data!.egresos_caja.monto_sin_comprobante)})`
                  : ""}
                . Los egresos migrados no trajeron comprobante: lo que se cargue de ahora en más sí
                aparece acá. Se ven uno por uno en{" "}
                <Link href="/reportes/ingresos-egresos" className="font-medium text-[#4FAEB2] hover:underline">
                  Reportes → Ingresos y egresos
                </Link>.
              </p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Un gasto es deducible cuando tiene <strong>número de factura</strong>,{" "}
            <strong>timbrado</strong> y <strong>RUC del proveedor</strong>. Si le falta alguno, la
            factura no respalda nada, y eso no se ve en la pantalla de Gastos: ahí se cargó igual. El
            reporte se calcula al abrirlo, así que corregir el dato en el gasto lo saca de esta lista.
          </p>
        </>
      )}
    </div>
  );
}
