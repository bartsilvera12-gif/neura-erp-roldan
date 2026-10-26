"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ExportarTablaButton from "@/components/ui/ExportarTablaButton";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const num = (n: number, dec = 0) =>
  Number(n || 0).toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec });

type Estado = "sin_stock" | "critico" | "bajo" | "ok" | "sin_consumo";

type Fila = {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad: string | null;
  stock_actual: number;
  stock_minimo: number;
  costo_promedio: number;
  proveedor_nombre: string | null;
  consumo_periodo: number;
  consumo_diario: number;
  dias_cobertura: number | null;
  sugerido: number;
  costo_sugerido: number;
  estado: Estado;
  minimo_sugerido: number | null;
  pico_mes: number | null;
  meses_con_venta: number | null;
  rubro_nombre: string | null;
  dias_critico: number;
  critico_del_rubro: boolean;
};

type Respuesta = {
  dias: number;
  cobertura: number;
  filas: Fila[];
  meses_minimo: number;
  minimos_disponibles: boolean;
  rubros_con_umbral: number;
  resumen: {
    productos: number; sin_stock: number; criticos: number;
    bajos: number; a_reponer: number; costo_total: number;
    minimos_a_actualizar: number;
  };
};

const ETIQUETA: Record<Estado, { texto: string; clase: string }> = {
  sin_stock:   { texto: "Sin stock",   clase: "bg-red-50 text-red-700 ring-red-200" },
  critico:     { texto: "Crítico",     clase: "bg-orange-50 text-orange-700 ring-orange-200" },
  bajo:        { texto: "Bajo",        clase: "bg-amber-50 text-amber-700 ring-amber-200" },
  ok:          { texto: "OK",          clase: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  sin_consumo: { texto: "Sin consumo", clase: "bg-slate-50 text-slate-500 ring-slate-200" },
};

/** Los parámetros quedan por navegador: cada encargado usa su propio criterio. */
function leerParam(clave: string, def: number): number {
  if (typeof window === "undefined") return def;
  const v = parseInt(window.localStorage.getItem(clave) ?? "", 10);
  return Number.isFinite(v) ? v : def;
}

export default function SugerenciasReposicionPage() {
  const [dias, setDias] = useState(() => leerParam("reposicion:dias", 60));
  const [cobertura, setCobertura] = useState(() => leerParam("reposicion:cobertura", 30));
  const [soloAReponer, setSoloAReponer] = useState(true);
  // Filtros de trabajo: con cientos de artículos, la lista entera no se
  // recorre. Se filtra sobre lo ya calculado y no se vuelve a pedir al
  // servidor: el cálculo depende de los días y la cobertura, no del rubro.
  const [fRubro, setFRubro] = useState("");
  const [fBuscar, setFBuscar] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("reposicion:dias", String(dias));
      window.localStorage.setItem("reposicion:cobertura", String(cobertura));
    } catch { /* modo privado: se usan los valores de esta sesión */ }
  }, [dias, cobertura]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/inventario/sugerencias?dias=${dias}&cobertura=${cobertura}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo calcular la reposición.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [dias, cobertura]);

  useEffect(() => { void cargar(); }, [cargar]);

  /**
   * Escribe los mínimos sugeridos en los productos.
   *
   * Pregunta antes porque pisa valores cargados a mano, y dice cuántos va a
   * tocar: "actualizar mínimos" sin número no deja decidir nada.
   */
  async function aplicarMinimos(soloVacios: boolean) {
    const n = data?.resumen.minimos_a_actualizar ?? 0;
    const texto = soloVacios
      ? "Se van a cargar los mínimos solo en los productos que hoy no tienen ninguno. No se toca nada cargado a mano.\n\n¿Seguimos?"
      : `Se van a actualizar los mínimos de ${n} ${n === 1 ? "producto" : "productos"} con la mediana de ventas de los últimos ${data?.meses_minimo ?? 6} meses.\n\nLos mínimos que alguien haya puesto a mano se reemplazan.\n\n¿Seguimos?`;
    if (!window.confirm(texto)) return;

    setAplicando(true);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/inventario/stock-minimo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solo_vacios: soloVacios }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudieron actualizar los mínimos.");
      const d = j.data as { actualizados: number; sin_cambios: number; mensaje?: string };
      setAviso(
        d.mensaje ??
        `${d.actualizados} ${d.actualizados === 1 ? "mínimo actualizado" : "mínimos actualizados"}` +
        (d.sin_cambios > 0 ? `, ${d.sin_cambios} ya estaban al día.` : ".")
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setAplicando(false);
    }
  }

  const todas = data?.filas ?? [];

  // Los rubros que de verdad aparecen en el resultado. Listar todo el catálogo
  // ofrecería rubros que no tienen ni un producto para reponer.
  const rubrosEnLista = Array.from(
    new Set(todas.map((f) => (f.rubro_nombre ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"));

  const texto = fBuscar.trim().toLowerCase();
  const filas = todas
    .filter((f) => (soloAReponer ? f.sugerido > 0 : true))
    .filter((f) => !fRubro || (fRubro === "__sin__" ? !f.rubro_nombre : f.rubro_nombre === fRubro))
    .filter((f) => !fEstado || f.estado === fEstado)
    .filter(
      (f) =>
        !texto ||
        f.nombre.toLowerCase().includes(texto) ||
        (f.sku ?? "").toLowerCase().includes(texto) ||
        (f.proveedor_nombre ?? "").toLowerCase().includes(texto)
    );
  const r = data?.resumen;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventario" className="text-xs font-medium text-slate-500 hover:text-slate-800">
          ← Volver a inventario
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Reposición</h1>
        <p className="text-sm text-slate-500">
          Cuánto se consumió, cuánto queda y cuánto conviene comprar.
        </p>
      </div>

      {/* Los dos parámetros que cambian todo el cálculo, a la vista y editables. */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Analizar los últimos</span>
          <div className="flex items-center gap-2">
            <input
              type="number" min={7} max={365} value={dias}
              onChange={(e) => setDias(Math.min(365, Math.max(7, Number(e.target.value) || 60)))}
              className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
            <span className="text-sm text-slate-500">días</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Quiero stock para</span>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={365} value={cobertura}
              onChange={(e) => setCobertura(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
              className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
            <span className="text-sm text-slate-500">días</span>
          </div>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloAReponer} onChange={(e) => setSoloAReponer(e.target.checked)} />
          Mostrar solo lo que hay que reponer
        </label>
        {data && (
          <p className="pb-2 text-[11px] leading-snug text-slate-400">
            {data.rubros_con_umbral > 0 ? (
              <>
                <b>{data.rubros_con_umbral}</b>{" "}
                {data.rubros_con_umbral === 1 ? "rubro tiene" : "rubros tienen"} su propio
                umbral crítico.{" "}
              </>
            ) : null}
            El resto usa {Math.round((data.cobertura / 3) * 10) / 10} días (un tercio de la
            cobertura).{" "}
            <Link href="/inventario/categorias" className="underline hover:text-slate-600">
              Configurar por rubro
            </Link>
          </p>
        )}
      </div>

      {/* Mínimo automático (punto 1.2). Separado de los parámetros de arriba
          porque responde otra pregunta: no "cuánto compro ahora" sino "cuánto
          no debería bajar nunca". */}
      {data && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Mínimo automático</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                {data.minimos_disponibles ? (
                  <>
                    Calculado con la <b>mediana</b> de lo vendido por mes en los últimos{" "}
                    {data.meses_minimo} meses cerrados. Se usa la mediana y no el promedio
                    para que una venta grande de una sola vez no deje un mínimo inflado.
                    {data.resumen.minimos_a_actualizar > 0 ? (
                      <> Hoy hay <b>{data.resumen.minimos_a_actualizar}</b>{" "}
                      {data.resumen.minimos_a_actualizar === 1 ? "producto" : "productos"} con el
                      mínimo distinto del sugerido.</>
                    ) : (
                      <> Los mínimos cargados ya coinciden con el sugerido.</>
                    )}
                  </>
                ) : (
                  <>No se pudo calcular: no hay ventas en el período o falta la conexión directa a la base.</>
                )}
              </p>
            </div>
            {data.minimos_disponibles && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void aplicarMinimos(true)}
                  disabled={aplicando}
                  className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-[#4FAEB2] hover:text-[#4FAEB2] disabled:opacity-50"
                  title="Carga el mínimo solo donde hoy no hay ninguno. No pisa nada cargado a mano."
                >
                  Solo los vacíos
                </button>
                <button
                  type="button"
                  onClick={() => void aplicarMinimos(false)}
                  disabled={aplicando || data.resumen.minimos_a_actualizar === 0}
                  className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/30 transition-all hover:bg-[#3F8E91] disabled:opacity-40"
                >
                  {aplicando ? "Actualizando…" : "Actualizar todos"}
                </button>
              </div>
            )}
          </div>
          {aviso && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
              {aviso}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {r && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Sin stock" valor={String(r.sin_stock)} tono="rojo" />
          <Tarjeta label="Críticos" valor={String(r.criticos)} tono="naranja" />
          <Tarjeta label="Bajos" valor={String(r.bajos)} tono="ambar" />
          <Tarjeta label="Costo de reponer" valor={gs(r.costo_total)}
            sub={`${r.a_reponer} de ${r.productos} productos`} />
        </div>
      )}

      {/* Filtros de trabajo. Van aparte de los parámetros de arriba a propósito:
          aquellos cambian el CÁLCULO (hay que recalcular), estos solo acotan
          lo que se mira. Mezclados, nadie sabría cuál de los dos hace qué. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Rubro</span>
          <select
            value={fRubro}
            onChange={(e) => setFRubro(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {rubrosEnLista.map((r) => <option key={r} value={r}>{r}</option>)}
            <option value="__sin__">Sin rubro</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Estado</span>
          <select
            value={fEstado}
            onChange={(e) => setFEstado(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="sin_stock">Sin stock</option>
            <option value="critico">Crítico</option>
            <option value="bajo">Bajo</option>
            <option value="ok">OK</option>
            <option value="sin_consumo">Sin consumo</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Buscar</span>
          <input
            type="text"
            value={fBuscar}
            onChange={(e) => setFBuscar(e.target.value)}
            placeholder="Producto, código o proveedor"
            className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        {(fRubro || fEstado || fBuscar) && (
          <button
            type="button"
            onClick={() => { setFRubro(""); setFEstado(""); setFBuscar(""); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Limpiar
          </button>
        )}
        <span className="pb-2 text-xs text-slate-400">
          {filas.length} de {todas.length} producto(s)
        </span>
        <div className="ml-auto pb-1">
          <ExportarTablaButton
            titulo="Reposición sugerida"
            archivo="reposicion"
            subtitulo={`Consumo de ${dias} días · cobertura de ${cobertura} días`}
            columnas={["Producto", "SKU", "Rubro", "Proveedor", "Stock", "Mínimo", "Sugerido", "Consumo/día", "Estado", "Costo"]}
            filas={filas.map((f) => [
              f.nombre,
              f.sku ?? "",
              f.rubro_nombre ?? "",
              f.proveedor_nombre ?? "",
              f.stock_actual,
              f.stock_minimo,
              f.sugerido,
              f.consumo_diario,
              ETIQUETA[f.estado]?.texto ?? f.estado,
              f.costo_sugerido,
            ])}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Rubro</th>
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Mínimo</th>
                <th className="px-4 py-3 text-right">Sugerido</th>
                <th className="px-4 py-3 text-right">Consumo/día</th>
                <th className="px-4 py-3 text-right">Alcanza</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Comprar</th>
                <th className="px-4 py-3 text-right">Costo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-400">Calculando…</td></tr>
              ) : filas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                    {fRubro || fEstado || fBuscar
                      ? "Ningún producto coincide con los filtros."
                      : soloAReponer
                      ? "No hay nada para reponer con estos parámetros."
                      : "No hay productos que controlen stock."}
                  </td>
                </tr>
              ) : (
                filas.map((f) => {
                  const et = ETIQUETA[f.estado];
                  return (
                    <tr key={f.producto_id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{f.nombre}</p>
                        {f.sku && <p className="font-mono text-[11px] text-slate-400">{f.sku}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{f.rubro_nombre ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500">{f.proveedor_nombre ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{num(f.stock_actual)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                        {f.stock_minimo > 0 ? num(f.stock_minimo) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {f.minimo_sugerido == null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span
                            className={
                              f.minimo_sugerido !== f.stock_minimo
                                ? "font-semibold text-[#3F8E91]"
                                : "text-slate-400"
                            }
                            title={
                              f.pico_mes != null
                                ? `Mejor mes: ${num(f.pico_mes)} · vendió en ${f.meses_con_venta} de ${data?.meses_minimo ?? 6} meses`
                                : undefined
                            }
                          >
                            {num(f.minimo_sugerido)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {f.consumo_diario > 0 ? num(f.consumo_diario, 2) : "—"}
                      </td>
                      <td
                        className="px-4 py-2.5 text-right tabular-nums text-slate-600"
                        title={`Crítico por debajo de ${num(f.dias_critico)} días${f.critico_del_rubro ? ` (umbral del rubro ${f.rubro_nombre ?? ""})` : " (umbral general)"}`}
                      >
                        {f.dias_cobertura == null ? "—" : `${num(f.dias_cobertura)} d`}
                        {f.critico_del_rubro && (
                          <span className="ml-1 text-[10px] text-slate-300">·{num(f.dias_critico)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ${et.clase}`}>
                          {et.texto}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">
                        {f.sugerido > 0 ? num(f.sugerido) : <span className="font-normal text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {f.sugerido > 0 ? gs(f.costo_sugerido) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1 text-[11px] leading-snug text-slate-400">
        <p>
          <strong>Consumo/día</strong> = unidades que salieron en los últimos {data?.dias ?? dias} días,
          divididas por esos días. <strong>Alcanza</strong> = cuántos días aguanta el stock a ese ritmo.
          <strong> Comprar</strong> = lo que falta para llegar a {data?.cobertura ?? cobertura} días de stock,
          nunca por debajo del mínimo del producto.
        </p>
        <p>
          <strong>Crítico</strong> se decide con los días que tenga configurado el rubro
          (Inventario → Rubros → columna &quot;Crítico bajo&quot;). Es lo que tarda reponerlo:
          la chapa quince días, el tornillo cinco. El rubro que no lo tenga configurado usa
          un tercio de la cobertura pedida acá arriba. El numerito gris al lado de
          &quot;Alcanza&quot; es el umbral propio del rubro.
        </p>
        <p>
          Las transferencias entre depósitos no cuentan como consumo: mueven la mercadería de lugar,
          no la gastan. Contarlas haría comprar de más.
        </p>
        <p>
          <strong>Sugerido</strong> es la mediana de lo vendido por mes en los últimos{" "}
          {data?.meses_minimo ?? 6} meses cerrados. El mes en curso no cuenta porque está
          incompleto, y los meses sin ventas cuentan como cero: un producto que se vendió
          fuerte dos meses y nada los otros cuatro no es un producto de stock permanente.
          Pasá el mouse por el número para ver el mejor mes.
        </p>
        <p>
          <strong>Sin consumo</strong> no es lo mismo que <strong>OK</strong>: significa que el producto no
          tuvo salidas en el período, así que no hay con qué estimar. Si igual querés tenerlo en stock,
          cargale un mínimo en su ficha.
        </p>
      </div>
    </div>
  );
}

function Tarjeta({
  label, valor, sub, tono = "neutro",
}: {
  label: string; valor: string; sub?: string;
  tono?: "neutro" | "rojo" | "naranja" | "ambar";
}) {
  const color =
    tono === "rojo" ? "text-red-600"
    : tono === "naranja" ? "text-orange-600"
    : tono === "ambar" ? "text-amber-600"
    : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
