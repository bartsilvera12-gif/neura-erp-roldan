"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Valoración de existencias a una fecha (punto 1.6).
 *
 * Responde "cuánta plata había en el depósito el 31 de diciembre", que no es
 * lo mismo que el stock de hoy valuado al costo de hoy.
 */

type Fila = {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  rubro_id: string | null;
  rubro_nombre: string | null;
  cantidad: number;
  costo_unitario: number;
  valor_total: number;
  stock_hoy: number;
  indeterminados: number;
};

type Respuesta = {
  fecha: string;
  filas: Fila[];
  total_articulos: number;
  total_unidades: number;
  valor_total: number;
  indeterminados: number;
  truncado: boolean;
};

type RubroLite = { id: string; nombre: string };

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const num = (n: number, dec = 0) =>
  Number(n || 0).toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function hoyPy(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 31 de diciembre del año pasado: el corte que más se pide. */
function cierreAnioPasado(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear() - 1}-12-31`;
}

export default function ValoracionPage() {
  const [fecha, setFecha] = useState(() => hoyPy());
  const [rubro, setRubro] = useState("");
  const [rubros, setRubros] = useState<RubroLite[]>([]);
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState(false);

  useEffect(() => {
    fetch("/api/inventario/categorias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          setRubros(((j.data?.categorias ?? []) as RubroLite[]).map((c) => ({ id: c.id, nombre: c.nombre })));
        }
      })
      .catch(() => { /* el filtro de rubro queda vacío; la pantalla sirve igual */ });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ fecha });
      if (rubro) sp.set("rubro", rubro);
      const r = await fetchWithSupabaseSession(`/api/inventario/valoracion?${sp}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo calcular la valoración.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [fecha, rubro]);

  useEffect(() => { void cargar(); }, [cargar]);

  const filas = data?.filas ?? [];

  /** Totales por rubro, para la vista agrupada. */
  const porRubro = useMemo(() => {
    const m = new Map<string, { nombre: string; articulos: number; unidades: number; valor: number }>();
    for (const f of filas) {
      const k = f.rubro_id ?? "__sin__";
      const act = m.get(k) ?? { nombre: f.rubro_nombre ?? "Sin rubro", articulos: 0, unidades: 0, valor: 0 };
      act.articulos += 1;
      act.unidades += f.cantidad;
      act.valor += f.valor_total;
      m.set(k, act);
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor);
  }, [filas]);

  const esHoy = fecha === hoyPy();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventario" className="text-xs font-medium text-slate-500 hover:text-slate-800">
          ← Volver a inventario
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Valoración de existencias</h1>
        <p className="text-sm text-slate-500">
          Cuánta mercadería había y cuánto valía, a la fecha que elijas.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Al cierre del día</span>
          <input
            type="date" value={fecha} max={hoyPy()}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2 pb-1.5">
          <button type="button" onClick={() => setFecha(hoyPy())}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]">
            Hoy
          </button>
          <button type="button" onClick={() => setFecha(cierreAnioPasado())}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]">
            Cierre {new Date().getFullYear() - 1}
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Rubro</span>
          <select
            value={rubro} onChange={(e) => setRubro(e.target.value)}
            className="min-w-[180px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todos (general)</option>
            {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} />
          Ver totales por rubro
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
        >
          Imprimir
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {data?.truncado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hay demasiados movimientos para reconstruir de una vez. Este resultado está incompleto:
          filtrá por rubro para achicarlo.
        </div>
      )}

      {data && data.indeterminados > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{data.indeterminados}</b>{" "}
          {data.indeterminados === 1 ? "ajuste viejo no se pudo aplicar" : "ajustes viejos no se pudieron aplicar"}:
          son anteriores al registro del signo y no se sabe si sumaron o restaron. Las líneas
          afectadas están marcadas. El total es aproximado en esos productos.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Artículos" valor={num(data.total_articulos)} />
          <Tarjeta label="Unidades" valor={num(data.total_unidades, 0)} />
          <Tarjeta label="Valor del stock" valor={gs(data.valor_total)} destacado />
          <Tarjeta
            label="Al cierre del"
            valor={fecha.split("-").reverse().join("/")}
            sub={esHoy ? "hoy" : "reconstruido"}
          />
        </div>
      )}

      {agrupar ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Rubro</th>
                <th className="px-4 py-3 text-right">Artículos</th>
                <th className="px-4 py-3 text-right">Unidades</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">% del total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">Reconstruyendo…</td></tr>
              ) : porRubro.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No había stock a esa fecha.</td></tr>
              ) : porRubro.map((r) => (
                <tr key={r.nombre} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.nombre}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{num(r.articulos)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{num(r.unidades)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{gs(r.valor)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                    {data && data.valor_total > 0 ? `${Math.round((r.valor / data.valor_total) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Rubro</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3 text-right">Costo unitario</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  {!esHoy && <th className="px-4 py-3 text-right">Stock hoy</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cargando ? (
                  <tr><td colSpan={esHoy ? 5 : 6} className="px-4 py-12 text-center text-slate-400">Reconstruyendo…</td></tr>
                ) : filas.length === 0 ? (
                  <tr>
                    <td colSpan={esHoy ? 5 : 6} className="px-4 py-12 text-center text-slate-400">
                      No había stock a esa fecha.
                    </td>
                  </tr>
                ) : filas.map((f) => (
                  <tr key={f.producto_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">
                        {f.nombre}
                        {f.indeterminados > 0 && (
                          <span
                            className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"
                            title="Tiene ajustes viejos sin signo: la cantidad puede no ser exacta."
                          >
                            aprox.
                          </span>
                        )}
                      </p>
                      {f.sku && <p className="font-mono text-[11px] text-slate-400">{f.sku}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{f.rubro_nombre ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {num(f.cantidad)} {f.unidad && <span className="text-slate-400">{f.unidad}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{gs(f.costo_unitario)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{gs(f.valor_total)}</td>
                    {!esHoy && (
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{num(f.stock_hoy)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
              {filas.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-3 text-slate-700" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{num(data?.total_unidades ?? 0)}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{gs(data?.valor_total ?? 0)}</td>
                    {!esHoy && <td className="px-4 py-3"></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <div className="space-y-1 text-[11px] leading-snug text-slate-400">
        <p>
          La cantidad y el costo de una fecha pasada se reconstruyen volviendo a pasar los
          movimientos hasta ese día, llevando el costo promedio ponderado igual que lo lleva el
          sistema en vivo. No se usa el costo de hoy: valuar el stock de diciembre con el costo
          de hoy mezcla dos momentos y da un número que no es ni uno ni el otro.
        </p>
        <p>
          Las salidas no cambian el costo promedio — sacar mercadería no cambia lo que costó la
          que queda. Los productos sin movimientos hasta esa fecha no se listan: no existían
          todavía en el depósito.
        </p>
      </div>
    </div>
  );
}

function Tarjeta({
  label, valor, sub, destacado = false,
}: { label: string; valor: string; sub?: string; destacado?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${destacado ? "border-[#4FAEB2]/40" : "border-slate-200"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${destacado ? "text-xl text-[#3F8E91]" : "text-xl text-slate-900"}`}>
        {valor}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
