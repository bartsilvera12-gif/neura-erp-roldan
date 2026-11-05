"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import AccionesTabla from "@/components/ui/AccionesTabla";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  faltante, severidad, valorFaltante, lineasParaOrden,
  type ArticuloBajoMinimo, type GrupoRubro, type ResumenBajoMinimo,
} from "@/lib/inventario/bajo-minimo";
import NuevaOrdenCompraModal from "@/components/compras/NuevaOrdenCompraModal";
import { ShoppingCart } from "lucide-react";
import Selector from "@/components/ui/Selector";

/**
 * Reposición: qué está por debajo del mínimo, por rubro.
 *
 * Es la lista con la que se arma la orden de compra. Se lee de arriba hacia
 * abajo y se corta cuando se acaba el presupuesto, así que dentro de cada
 * rubro lo que está en cero va primero.
 */

type Respuesta = {
  grupos: GrupoRubro[];
  resumen: ResumenBajoMinimo;
  articulos_evaluados: number;
  sin_minimo: number;
  total_sin_filtrar: number;
  rubros: { id: string; nombre: string }[];
};

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const uni = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("es-PY") : v.toLocaleString("es-PY", { maximumFractionDigits: 2 });

export default function BajoMinimoPage() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rubro, setRubro] = useState("");
  const [q, setQ] = useState("");
  const [soloSinStock, setSoloSinStock] = useState(false);
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  // Lo tildado para llevar a una orden de compra. Se guarda por id y no por
  // índice: los filtros reordenan la lista y un índice apuntaría a otra cosa.
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [armandoOrden, setArmandoOrden] = useState(false);
  const [ordenCreada, setOrdenCreada] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (rubro) p.set("rubro", rubro);
      if (q.trim()) p.set("q", q.trim());
      if (soloSinStock) p.set("solo", "sin_stock");
      const r = await fetchWithSupabaseSession(`/api/inventario/bajo-minimo?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar la lista.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [rubro, q, soloSinStock]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, q]);

  function alternar(clave: string) {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  }

  function elegir(id: string) {
    setElegidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Tilda o destilda todo un rubro de una. */
  function elegirRubro(g: GrupoRubro, marcar: boolean) {
    setElegidos((prev) => {
      const next = new Set(prev);
      for (const a of g.articulos) {
        if (marcar) next.add(a.producto_id);
        else next.delete(a.producto_id);
      }
      return next;
    });
  }

  /** Los artículos tildados, en el orden en que se ven en pantalla. */
  const seleccionados: ArticuloBajoMinimo[] = useMemo(() => {
    if (!data) return [];
    return data.grupos.flatMap((g) => g.articulos.filter((a) => elegidos.has(a.producto_id)));
  }, [data, elegidos]);

  /** Una fila por artículo, con su rubro, para Excel y para la hoja impresa. */
  const filasExport = useMemo(() => {
    if (!data) return [];
    return data.grupos.flatMap((g) =>
      g.articulos.map((a) => [
        g.rubro_nombre,
        a.sku ?? "",
        a.nombre,
        a.unidad ?? "",
        a.stock_actual,
        a.stock_minimo,
        faltante(a),
        Math.round(a.costo_promedio),
        Math.round(valorFaltante(a)),
      ])
    );
  }, [data]);

  const r = data?.resumen;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Inventario"
        title="Reposición: bajo mínimo"
        description="Lo que está por debajo del mínimo de su ficha, por rubro, para armar la orden de compra"
      />

      {/* ── Filtros ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rubro</span>
          <Selector
            value={rubro} onChange={(e) => setRubro(e.target.value)}
            className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {(data?.rubros ?? []).map((x) => (
              <option key={x.id} value={x.id}>{x.nombre}</option>
            ))}
            <option value="__sin__">(sin rubro)</option>
          </Selector>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buscar</span>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código"
            className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox" checked={soloSinStock}
            onChange={(e) => setSoloSinStock(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Solo los que están en cero
        </label>

        {data && filasExport.length > 0 && (
          <AccionesTabla
            className="ml-auto"
            titulo="Reposición: artículos bajo mínimo"
            archivo="bajo-minimo"
            subtitulo={`${r?.articulos ?? 0} artículos en ${r?.rubros ?? 0} rubros · faltan Gs. ${gs(r?.valor_total ?? 0)} al costo`}
            columnas={["Rubro", "Código", "Artículo", "Unidad", "Stock", "Mínimo", "Faltan", "Costo", "A reponer Gs."]}
            filas={filasExport}
            sumar={[6, 8]}
          />
        )}
      </div>

      {/* Barra de la selección. Aparece solo cuando hay algo tildado: el resto
          del tiempo sería una franja vacía ocupando lugar. */}
      {seleccionados.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#4FAEB2] bg-[#4FAEB2]/10 px-3 py-2">
          <span className="text-sm font-semibold text-[#2F6E71]">
            {uni(seleccionados.length)} {seleccionados.length === 1 ? "artículo elegido" : "artículos elegidos"}
          </span>
          <span className="text-[11px] text-slate-600">
            Gs. {gs(seleccionados.reduce((acc, a) => acc + valorFaltante(a), 0))} al costo
          </span>
          <button
            type="button" onClick={() => setElegidos(new Set())}
            className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            Limpiar
          </button>
          <button
            type="button" onClick={() => setArmandoOrden(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
          >
            <ShoppingCart className="h-4 w-4" /> Armar orden de compra
          </button>
        </div>
      )}

      {ordenCreada && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <span className="flex-1">
            Se creó la orden <strong>{ordenCreada}</strong>. Está en Compras → Órdenes de compra, para
            imprimirla o mandársela al proveedor.
          </span>
          <Link href="/ordenes-compra" className="font-semibold underline underline-offset-2">Ver</Link>
          <button type="button" onClick={() => setOrdenCreada(null)} className="text-emerald-600">✕</button>
        </div>
      )}

      {/* ── Resumen ───────────────────────────────────────────────────── */}
      {r && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta titulo="Artículos" valor={uni(r.articulos)} pie={`en ${r.rubros} rubros`} />
          <Tarjeta titulo="En cero" valor={uni(r.sin_stock)} pie="sin una sola unidad" acento />
          <Tarjeta titulo="Unidades que faltan" valor={uni(r.faltante_total)} pie="para llegar al mínimo" />
          <Tarjeta titulo="A reponer" valor={`Gs. ${gs(r.valor_total)}`} pie="al costo promedio" />
        </div>
      )}

      {/* La lista solo puede hablar de los artículos que TIENEN mínimo cargado.
          Decir sobre cuántos se mira es la diferencia entre un informe y una
          cifra sin contexto. */}
      {data && data.sin_minimo > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          Esta lista mira los <strong>{uni(data.articulos_evaluados - data.sin_minimo)}</strong> artículos
          que tienen mínimo cargado. Los otros <strong>{uni(data.sin_minimo)}</strong> no lo tienen, así que
          no se puede saber si faltan: no aparecen acá ni cuando están en cero.{" "}
          <Link href="/inventario/sugerencias" className="font-semibold underline underline-offset-2">
            Sugerencias de reposición
          </Link>{" "}
          los calcula por consumo y permite cargarlos de una.
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : !data || data.grupos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">
            {data && data.total_sin_filtrar > 0
              ? "Ningún artículo coincide con estos filtros."
              : "No hay nada por debajo del mínimo."}
          </p>
          {data && data.total_sin_filtrar > 0 && (
            <p className="mt-1 text-sm text-slate-500">
              Hay {uni(data.total_sin_filtrar)} bajo mínimo en total. Probá sacando algún filtro.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data.grupos.map((g) => {
            const clave = g.rubro_id ?? "__sin__";
            const cerrado = colapsados.has(clave);
            const todosElegidos = g.articulos.every((a) => elegidos.has(a.producto_id));
            return (
              <section key={clave} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex w-full items-center gap-3 bg-slate-50 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={todosElegidos}
                    onChange={(e) => elegirRubro(g, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 shrink-0 rounded border-slate-300"
                    title="Elegir todo el rubro para la orden de compra"
                  />
                <button
                  type="button"
                  onClick={() => alternar(clave)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <span className="text-xs text-slate-400">{cerrado ? "▸" : "▾"}</span>
                  <span className="font-semibold text-slate-800">{g.rubro_nombre}</span>
                  <span className="text-xs text-slate-500">
                    {uni(g.cantidad)} {g.cantidad === 1 ? "artículo" : "artículos"}
                    {g.sin_stock > 0 && (
                      <span className="ml-1.5 rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
                        {uni(g.sin_stock)} en cero
                      </span>
                    )}
                  </span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700">
                    Gs. {gs(g.valor_total)}
                  </span>
                </button>
                </div>

                {!cerrado && (
                  <EdgeScrollArea>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="w-8 px-2 py-2" />
                          <th className="px-4 py-2 text-left font-semibold">Artículo</th>
                          <th className="px-3 py-2 text-right font-semibold">Stock</th>
                          <th className="px-3 py-2 text-right font-semibold">Mínimo</th>
                          <th className="px-3 py-2 text-right font-semibold">Faltan</th>
                          <th className="px-3 py-2 text-right font-semibold">Costo</th>
                          <th className="px-4 py-2 text-right font-semibold">A reponer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.articulos.map((a) => {
                          const cero = severidad(a) === "sin_stock";
                          return (
                            <tr key={a.producto_id} className="border-b border-slate-100 last:border-0">
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={elegidos.has(a.producto_id)}
                                  onChange={() => elegir(a.producto_id)}
                                  className="h-4 w-4 rounded border-slate-300"
                                  title="Llevar a la orden de compra"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <Link
                                  href={`/inventario/${a.producto_id}`}
                                  className="font-medium text-slate-800 hover:text-[#4FAEB2]"
                                >
                                  {a.nombre}
                                </Link>
                                {a.sku && <span className="ml-1.5 text-[11px] text-slate-400">{a.sku}</span>}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums ${cero ? "font-semibold text-rose-600" : "text-slate-700"}`}>
                                {cero ? "0" : uni(a.stock_actual)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-500">{uni(a.stock_minimo)}</td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                                {uni(faltante(a))}
                                {a.unidad && <span className="ml-1 text-[10px] font-normal text-slate-400">{a.unidad}</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                                {a.costo_promedio > 0 ? gs(a.costo_promedio) : "—"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {a.costo_promedio > 0 ? gs(valorFaltante(a)) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </EdgeScrollArea>
                )}
              </section>
            );
          })}
        </div>
      )}

      {armandoOrden && (
        <NuevaOrdenCompraModal
          itemsIniciales={lineasParaOrden(seleccionados)}
          origen="la lista de bajo mínimo"
          onClose={() => setArmandoOrden(false)}
          onCreada={(numero) => {
            setArmandoOrden(false);
            setElegidos(new Set());
            setOrdenCreada(numero);
          }}
        />
      )}

      <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-500">
        <p>
          Tildá lo que vas a pedir y apretá <strong>Armar orden de compra</strong>: se arma con la
          cantidad que falta y el costo promedio de cada artículo, y los dos se pueden corregir antes
          de crearla. El proveedor se elige a mano, porque ningún artículo tiene proveedor principal
          cargado y adivinarlo sería presentar una suposición como un dato.
        </p>
        <p>
          Un artículo entra acá cuando su <strong>stock está por debajo del mínimo</strong> cargado en la
          ficha. <strong>Faltan</strong> es cuánto hay que comprar para volver al mínimo — no es una
          sugerencia de cuánto conviene comprar, es lo que falta para cumplir lo que ya se decidió.
        </p>
        <p>
          Dentro de cada rubro primero va lo que está en cero, y después lo que está más cerca de cero en
          proporción a su mínimo: un artículo con 1 de 100 está peor que uno con 95 de 100, aunque al
          segundo le falten más unidades.
        </p>
        <p>
          <strong>A reponer</strong> usa el costo promedio, que es lo último que se pagó ponderado, no el
          precio que va a cobrar el proveedor. Sirve para dimensionar la orden, no para firmarla.
        </p>
      </div>
    </div>
  );
}

function Tarjeta({
  titulo, valor, pie, acento,
}: { titulo: string; valor: string; pie: string; acento?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${acento ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${acento ? "text-rose-700" : "text-slate-900"}`}>{valor}</p>
      <p className="text-[11px] text-slate-400">{pie}</p>
    </div>
  );
}
