"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { EntradaFlujo, FlujoCajaMes, SaldoLiquidez, TipoSaldo } from "@/lib/flujo-caja/types";

/**
 * Flujo de caja de proveedores.
 *
 * Replica la planilla que se llevaba a mano: una fila por proveedor, una
 * columna por día del mes, y el color de cada celda según el estado del cheque.
 * Lo que antes iba en los comentarios de Excel (nº de factura, nº de carga,
 * nº de cheque y fecha de cobro) ahora sale de los datos y se arma solo.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Los tres colores de la planilla, más el gris de lo ya cobrado. */
const TONO: Record<string, string> = {
  pendiente_emision: "bg-violet-100 text-violet-900 ring-violet-300",
  emitido:           "bg-emerald-100 text-emerald-900 ring-emerald-300",
  cobrado:           "bg-amber-100 text-amber-900 ring-amber-300",
  anulado:           "bg-slate-100 text-slate-400 ring-slate-200 line-through",
};
const ETIQUETA: Record<string, string> = {
  pendiente_emision: "Cheque pendiente de emisión",
  emitido:           "Cheque emitido, sin cobrar",
  cobrado:           "Cheque cobrado — no suma al flujo",
  anulado:           "Anulado",
};

function miles(v: number, decimales = 0): string {
  return v.toLocaleString("es-PY", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}
function importeDe(e: EntradaFlujo): string {
  return e.moneda === "USD" ? `US$ ${miles(e.importe, 2)}` : miles(e.importe);
}

/** El comentario de la celda: lo mismo que anotaban en Excel, ya armado. */
function tooltipDe(e: EntradaFlujo): string {
  const l: string[] = [];
  if (e.facturas.length > 1) {
    l.push(`Cubre ${e.facturas.length} facturas:`);
    for (const f of e.facturas) {
      l.push(`  · ${f.numero_factura ?? "s/nº"}  (${f.numero_control})`);
    }
  } else {
    const f = e.facturas[0];
    if (f) l.push(`Factura ${f.numero_factura ?? "s/nº"}   ·   Carga ${f.numero_control}`);
  }
  if (e.numero_cheque) l.push(`Cheque Nº ${e.numero_cheque}${e.banco_nombre ? ` — ${e.banco_nombre}` : ""}`);
  else l.push("Sin cheque emitido");
  if (e.fecha_emision) l.push(`Emitido: ${e.fecha_emision}`);
  if (e.fecha_cobro) l.push(`Cobro: ${e.fecha_cobro}`);
  if (e.observacion) l.push(e.observacion);
  l.push(ETIQUETA[e.estado] ?? e.estado);
  return l.join("\n");
}

export default function FlujoCajaPage() {
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [data, setData] = useState<FlujoCajaMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config editable del mes.
  const [tc, setTc] = useState("");
  const [fondos, setFondos] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Posición de liquidez: bancos, efectivo y mercadería. Carga manual.
  const [saldos, setSaldos] = useState<SaldoLiquidez[]>([]);
  const [editandoSaldos, setEditandoSaldos] = useState(false);
  const [guardandoSaldos, setGuardandoSaldos] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/flujo-caja?anio=${anio}&mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const d = j.data as FlujoCajaMes;
      setData(d);
      setTc(d.config.tipo_cambio ? String(d.config.tipo_cambio) : "");
      setFondos(d.config.fondos_disponibles ? String(d.config.fondos_disponibles) : "");
      setSaldos(d.liquidez.detalle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el flujo.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [anio, mes]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardarConfig() {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/flujo-caja", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio, mes,
          tipo_cambio: Number(tc) || 0,
          fondos_disponibles: Number(fondos) || 0,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarSaldos() {
    setGuardandoSaldos(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/flujo-caja/saldos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anio, mes, saldos }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setEditandoSaldos(false);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los saldos.");
    } finally {
      setGuardandoSaldos(false);
    }
  }

  function agregarSaldo(tipo: TipoSaldo) {
    setSaldos((prev) => [...prev, { tipo, descripcion: "", moneda: "PYG", importe: 0 }]);
    setEditandoSaldos(true);
  }

  const dias = useMemo(
    () => Array.from({ length: data?.dias ?? 0 }, (_, i) => i + 1),
    [data?.dias]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Tesorería"
        title="Flujo de caja"
        description="Pagos a proveedores por día, con el estado de cada cheque."
      />

      {/* Período y parámetros del mes */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mes</span>
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Año</span>
          <input
            type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Tipo de cambio
          </span>
          <input
            type="number" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="6.400"
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Fondos disponibles (Gs.)
          </span>
          <input
            type="number" value={fondos} onChange={(e) => setFondos(e.target.value)} placeholder="0"
            className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <button
          type="button" onClick={guardarConfig} disabled={guardando}
          className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <p className="ml-auto max-w-xs text-[11px] leading-snug text-slate-500">
          El tipo de cambio lo fija la empresa: suele ir por encima del real para
          dejar colchón ante subas del dólar.
        </p>
      </div>

      {/* Posición de liquidez — informativa: la foto sobre la que se apoya el flujo.
          No alimenta la proyección de pagos; solo aporta los fondos iniciales. */}
      {data && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4FAEB2]">
                Posición de liquidez
              </p>
              <p className="text-[11px] text-slate-500">
                Bancos, efectivo y mercadería. Se cargan a mano: el ERP no tiene conciliación bancaria.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editandoSaldos ? (
                <>
                  <button
                    type="button" onClick={() => { setEditandoSaldos(false); void cargar(); }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button" onClick={guardarSaldos} disabled={guardandoSaldos}
                    className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    {guardandoSaldos ? "Guardando…" : "Guardar saldos"}
                  </button>
                </>
              ) : (
                <button
                  type="button" onClick={() => setEditandoSaldos(true)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Editar
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {(["banco", "efectivo", "mercaderia"] as const).map((tipo) => {
              const delTipo = saldos
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.tipo === tipo);
              const titulo = tipo === "banco" ? "Bancos" : tipo === "efectivo" ? "Efectivo en caja" : "Mercadería";
              return (
                <div key={tipo} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{titulo}</span>
                    {editandoSaldos && (
                      <button
                        type="button" onClick={() => agregarSaldo(tipo)}
                        className="text-[11px] font-semibold text-[#3F8E91] hover:underline"
                      >
                        + Agregar
                      </button>
                    )}
                  </div>
                  {delTipo.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Sin cargar</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {delTipo.map(({ s, i }) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs">
                          {editandoSaldos ? (
                            <>
                              <input
                                value={s.descripcion}
                                placeholder={tipo === "banco" ? "Banco" : tipo === "efectivo" ? "Caja" : "Depósito"}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs"
                              />
                              <select
                                value={s.moneda}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, moneda: e.target.value === "USD" ? "USD" : "PYG" } : x))}
                                className="rounded border border-slate-200 px-1 py-1 text-xs"
                              >
                                <option value="PYG">Gs.</option>
                                <option value="USD">US$</option>
                              </select>
                              <input
                                type="number" value={s.importe}
                                onChange={(e) => setSaldos((prev) => prev.map((x, j) => j === i ? { ...x, importe: Number(e.target.value) || 0 } : x))}
                                className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-xs tabular-nums"
                              />
                              <button
                                type="button" onClick={() => setSaldos((prev) => prev.filter((_, j) => j !== i))}
                                className="text-slate-400 hover:text-red-600" title="Quitar"
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate text-slate-600">{s.descripcion}</span>
                              <span className="tabular-nums font-medium text-slate-800">
                                {s.moneda === "USD" ? `US$ ${miles(s.importe, 2)}` : miles(s.importe)}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-xs">
            <span className="text-slate-600">
              Disponible al inicio:{" "}
              <strong className="tabular-nums text-slate-900">Gs. {miles(data.liquidez.total_gs)}</strong>
            </span>
            {data.liquidez.mercaderia_gs > 0 && (
              <span className="text-slate-500">
                Mercadería:{" "}
                <strong className="tabular-nums">Gs. {miles(data.liquidez.mercaderia_gs)}</strong>
                <span className="ml-1 text-slate-400">(no es plata disponible)</span>
              </span>
            )}
            <span className="ml-auto text-[11px] text-slate-400">
              {data.liquidez.origen === "saldos"
                ? "Los fondos del flujo salen de bancos + efectivo."
                : "Sin saldos cargados: se usa el monto manual de arriba."}
            </span>
          </div>
        </div>
      )}

      {/* Leyenda de colores */}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        {(["pendiente_emision", "emitido", "cobrado"] as const).map((k) => (
          <span key={k} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${TONO[k]}`}>
            {ETIQUETA[k]}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando…</p>
      ) : !data || data.filas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">No hay pagos proyectados en {MESES[mes - 1]} {anio}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Las facturas de compra a crédito caen acá solas, en la fecha de pago
            (fecha de factura más el plazo). Cargá una compra para verla.
          </p>
        </div>
      ) : (
        <EdgeScrollArea>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">
                  Proveedor
                </th>
                {dias.map((d) => (
                  <th key={d} className="min-w-[86px] px-2 py-2 text-center font-semibold text-slate-500">{d}</th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((fila) => (
                <tr key={fila.proveedor_id ?? "varios"} className="border-b border-slate-100">
                  <td className={`sticky left-0 z-10 bg-white px-3 py-2 font-medium ${fila.es_varios ? "text-slate-500 italic" : "text-slate-800"}`}>
                    {fila.nombre}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">{fila.moneda}</span>
                  </td>
                  {dias.map((d) => {
                    const entradas = fila.dias[d] ?? [];
                    return (
                      <td key={d} className="px-1 py-1 text-right align-top">
                        {entradas.map((e, i) => (
                          <span
                            key={`${e.cheque_id ?? e.numero_control}-${i}`}
                            title={tooltipDe(e)}
                            className={`mb-0.5 block cursor-help rounded px-1.5 py-1 text-right tabular-nums ring-1 ${TONO[e.estado] ?? ""}`}
                          >
                            {importeDe(e)}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                    {fila.moneda === "USD" ? `US$ ${miles(fila.total, 2)}` : miles(fila.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50/70">
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold text-slate-600">Subtotal US$</td>
                {data.totales.map((t) => (
                  <td key={t.dia} className="px-2 py-2 text-right tabular-nums text-slate-700">
                    {t.subtotal_usd ? miles(t.subtotal_usd, 2) : ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{miles(data.resumen.total_usd, 2)}</td>
              </tr>
              <tr className="bg-slate-50/70">
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold text-slate-600">Subtotal Gs.</td>
                {data.totales.map((t) => (
                  <td key={t.dia} className="px-2 py-2 text-right tabular-nums text-slate-700">
                    {t.subtotal_gs ? miles(t.subtotal_gs) : ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{miles(data.resumen.total_gs)}</td>
              </tr>
              <tr className="bg-white">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-slate-600">
                  Disponible Gs.
                </td>
                {data.totales.map((t) => (
                  <td
                    key={t.dia}
                    className={`px-2 py-2 text-right tabular-nums ${t.acumulado_gs < 0 ? "text-red-600" : "text-slate-700"}`}
                  >
                    {miles(t.acumulado_gs)}
                  </td>
                ))}
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${data.resumen.acumulado_final_gs < 0 ? "text-red-600" : "text-slate-800"}`}>
                  {miles(data.resumen.acumulado_final_gs)}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 text-[11px] font-medium text-slate-400">
                  Disponible US$
                </td>
                {data.totales.map((t) => (
                  <td key={t.dia} className="px-2 py-2 text-right text-[11px] tabular-nums text-slate-400">
                    {miles(t.acumulado_usd, 0)}
                  </td>
                ))}
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </EdgeScrollArea>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        <strong>Disponible</strong> arranca en los fondos del mes y baja con cada pago
        proyectado. En la planilla este número se llevaba en negativo; acá es positivo
        mientras quede plata, y pasa a rojo si los pagos del mes superan los fondos.
        Los cheques ya cobrados no suman: ya salieron del banco.
      </p>
    </div>
  );
}
