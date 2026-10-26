"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { colorMargen, pct } from "@/lib/precios/margen";
import ExportarTablaButton from "@/components/ui/ExportarTablaButton";

/**
 * Estudio de precios (punto 10.5).
 *
 * "Modificar precios, margen, remarcación y comisiones por rubro, masivo y por
 * fila; mostrar costo de compra, cantidad de artículos y filtros."
 *
 * ── SIEMPRE VISTA PREVIA ANTES DE APLICAR ─────────────────────────────────
 *   Un cambio masivo toca cientos de precios y no hay "deshacer". La pantalla
 *   no deja aplicar sin haber mostrado antes, fila por fila, qué precio queda
 *   y cuáles no se pueden tocar. La cuenta la hace el servidor en las dos
 *   puntas, así que lo que se aprueba es exactamente lo que se guarda.
 *
 * ── MARGEN Y REMARCACIÓN, LAS DOS ─────────────────────────────────────────
 *   Son la misma plata mirada desde dos lados y se confunden todo el tiempo
 *   (ver src/lib/precios/margen.ts). Acá van las dos columnas con su nombre,
 *   y el modo de cálculo dice cuál se está fijando.
 */

type Fila = {
  id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio: number;
  stock: number;
  rubro_id: string | null;
  rubro: string;
  margen: number;
  remarcacion: number | null;
};

type PorRubro = {
  rubro_id: string | null;
  rubro: string;
  articulos: number;
  costo: number;
  precio: number;
  margen: number;
  sin_costo: number;
  bajo_costo: number;
};

type Cambio = {
  id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio_actual: number;
  precio_nuevo: number;
  diferencia: number;
  margen_actual: number;
  margen_nuevo: number;
  bloqueo: string | null;
};

type Resumen = {
  productos: number;
  cambian: number;
  bloqueados: number;
  bajo_costo: number;
  margen_promedio_actual: number;
  margen_promedio_nuevo: number;
};

const gs = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const inputCls = "rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none";

export default function EstudioPreciosPage() {
  const { isAdmin } = useIsAdmin();

  const [rubro, setRubro] = useState("");
  const [q, setQ] = useState("");
  const [solo, setSolo] = useState("");

  const [filas, setFilas] = useState<Fila[]>([]);
  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([]);
  const [porRubro, setPorRubro] = useState<PorRubro[]>([]);
  const [recortado, setRecortado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Regla del cambio masivo.
  const [modo, setModo] = useState<"remarcacion" | "margen" | "ajuste">("remarcacion");
  const [valor, setValor] = useState("");
  const [redondeo, setRedondeo] = useState("500");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const [previa, setPrevia] = useState<{ cambios: Cambio[]; resumen: Resumen } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const qs = new URLSearchParams();
    if (rubro) qs.set("rubro", rubro);
    if (q.trim()) qs.set("q", q.trim());
    if (solo) qs.set("solo", solo);
    try {
      const r = await fetchWithSupabaseSession(`/api/precios/estudio?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(String(j?.error ?? "No se pudo cargar el estudio."));
        setFilas([]);
        return;
      }
      setFilas((j.data?.filas ?? []) as Fila[]);
      setRubros((j.data?.rubros ?? []) as { id: string; nombre: string }[]);
      setPorRubro((j.data?.por_rubro ?? []) as PorRubro[]);
      setRecortado(Boolean(j.data?.recortado));
    } catch {
      setError("No se pudo cargar el estudio.");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [rubro, q, solo]);

  useEffect(() => {
    const t = setTimeout(() => { cargar(); }, 400);
    return () => clearTimeout(t);
  }, [cargar]);

  // Cambiar la selección invalida la previa: mostrar una calculada sobre otra
  // lista sería lo más parecido a aplicar a ciegas.
  useEffect(() => { setPrevia(null); }, [rubro, q, solo, modo, valor, redondeo, marcados]);

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  async function pedir(aplicar: boolean) {
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v)) { setError("Poné el porcentaje."); return; }
    if (!rubro && marcados.size === 0) { setError("Elegí un rubro o marcá productos."); return; }

    setTrabajando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/precios/estudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aplicar,
          modo,
          valor: v,
          redondeo: Number(redondeo) || 0,
          ...(marcados.size > 0 ? { producto_ids: [...marcados] } : { rubro }),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) { setError(String(j?.error ?? "No se pudo procesar.")); return; }

      if (aplicar) {
        setPrevia(null);
        setMarcados(new Set());
        const fall = (j.data?.fallidos ?? []) as string[];
        setAviso(
          `Se actualizaron ${j.data?.escritos ?? 0} precios.` +
          (fall.length ? ` No se pudo con ${fall.length}: ${fall.slice(0, 5).join(", ")}.` : "")
        );
        await cargar();
      } else {
        setPrevia({ cambios: (j.data?.cambios ?? []) as Cambio[], resumen: j.data?.resumen as Resumen });
      }
    } catch {
      setError("No se pudo procesar.");
    } finally {
      setTrabajando(false);
    }
  }

  const etiquetaValor =
    modo === "remarcacion" ? "% sobre el costo"
    : modo === "margen" ? "% de margen objetivo"
    : "% de ajuste sobre el precio actual";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventario"
        title="Estudio de precios"
        description="Costo, precio, margen y remarcación por rubro, con cambios masivos"
        backHref="/inventario"
        backLabel="Inventario"
        actions={
          <div className="flex items-center gap-2">
          {/* Requisito 11.1: el estudio se analiza en planilla antes de
              decidir, no solo en pantalla. */}
          <ExportarTablaButton
            titulo="Estudio de precios"
            archivo="estudio-precios"
            columnas={["Producto", "SKU", "Rubro", "Stock", "Costo de compra", "Precio", "Margen %", "Remarcación %"]}
            filas={filas.map((f) => [
              f.nombre,
              f.sku,
              f.rubro,
              f.stock,
              f.costo,
              f.precio,
              Number(f.margen.toFixed(2)),
              f.remarcacion == null ? "" : Number(f.remarcacion.toFixed(2)),
            ])}
          />
          <Link
            href="/configuracion/comisiones"
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Comisiones por rubro
          </Link>
          </div>
        }
      />

      {/* Resumen por rubro: cuántos artículos y con qué margen (punto 10.5). */}
      {porRubro.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Rubro</th>
                <th className="px-4 py-2.5 font-semibold text-right">Artículos</th>
                <th className="px-4 py-2.5 font-semibold text-right">Margen</th>
                <th className="px-4 py-2.5 font-semibold text-right">Sin costo</th>
                <th className="px-4 py-2.5 font-semibold text-right">Bajo costo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {porRubro.map((r) => (
                <tr key={r.rubro_id ?? "__sin__"} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-700">
                    <button
                      type="button"
                      onClick={() => setRubro(r.rubro_id ?? "__sin__")}
                      className="hover:text-[#4FAEB2] hover:underline"
                    >
                      {r.rubro}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.articulos}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorMargen(r.margen)}`}>
                    {pct(r.margen)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                    {r.sin_costo || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.bajo_costo ? <span className="font-medium text-rose-600">{r.bajo_costo}</span> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Rubro</label>
            <select value={rubro} onChange={(e) => setRubro(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">Todos</option>
              {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              <option value="__sin__">Sin rubro</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o código" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Mostrar</label>
            <select value={solo} onChange={(e) => setSolo(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">Todos</option>
              <option value="bajo_costo">Se venden bajo el costo</option>
              <option value="sin_costo">Sin costo cargado</option>
              <option value="sin_precio">Sin precio</option>
            </select>
          </div>
        </div>
      </div>

      {/* Cambio masivo */}
      {isAdmin && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Cambio masivo</h2>
          <p className="mb-3 text-xs text-slate-500">
            Se aplica a {marcados.size > 0
              ? `los ${marcados.size} productos marcados`
              : rubro
              ? "todo el rubro elegido"
              : "— elegí un rubro o marcá productos"}.
            Siempre se ve la vista previa antes de guardar.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Cómo</label>
              <select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)} className={`${inputCls} w-full`}>
                <option value="remarcacion">Remarcación sobre el costo</option>
                <option value="margen">Margen objetivo</option>
                <option value="ajuste">Ajustar el precio actual</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">{etiquetaValor}</label>
              <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
                placeholder={modo === "ajuste" ? "Ej: 8 (o −5)" : "Ej: 60"} className={`${inputCls} w-full`} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Redondear a</label>
              <select value={redondeo} onChange={(e) => setRedondeo(e.target.value)} className={`${inputCls} w-full`}>
                <option value="0">Sin redondear</option>
                <option value="100">100 Gs.</option>
                <option value="500">500 Gs.</option>
                <option value="1000">1.000 Gs.</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => pedir(false)} disabled={trabajando}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {trabajando ? "…" : "Ver qué cambia"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Se redondea siempre hacia arriba: hacia abajo se regala margen en cada
            venta, y sobre cientos de artículos eso se nota.
          </p>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {aviso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</div>}
      {recortado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          La lista llegó al tope de 2000 productos. Filtrá por rubro para verla entera.
        </div>
      )}

      {/* Vista previa */}
      {previa && (
        <div className="rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/5 p-4">
          <h2 className="text-sm font-semibold text-slate-800">Vista previa</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cambian <strong>{previa.resumen.cambian}</strong> de {previa.resumen.productos} productos.
            {previa.resumen.bloqueados > 0 && <> {previa.resumen.bloqueados} no se pueden tocar.</>}
            {" "}El margen promedio pasa de <strong>{pct(previa.resumen.margen_promedio_actual)}</strong> a{" "}
            <strong>{pct(previa.resumen.margen_promedio_nuevo)}</strong>.
          </p>
          {previa.resumen.bajo_costo > 0 && (
            <p className="mt-1 text-sm font-medium text-rose-700">
              Atención: {previa.resumen.bajo_costo} quedarían por debajo del costo.
            </p>
          )}

          <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Producto</th>
                  <th className="px-3 py-2 font-semibold text-right">Costo</th>
                  <th className="px-3 py-2 font-semibold text-right">Precio actual</th>
                  <th className="px-3 py-2 font-semibold text-right">Precio nuevo</th>
                  <th className="px-3 py-2 font-semibold text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {previa.cambios.map((c) => (
                  <tr key={c.id} className={c.bloqueo ? "bg-slate-50 text-slate-400" : ""}>
                    <td className="px-3 py-1.5">
                      {c.nombre}
                      {c.bloqueo && <span className="ml-2 text-[11px] text-amber-600">{c.bloqueo}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{gs(c.costo)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{gs(c.precio_actual)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                      {c.bloqueo ? "—" : gs(c.precio_nuevo)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${c.bloqueo ? "" : colorMargen(c.margen_nuevo)}`}>
                      {c.bloqueo ? "—" : pct(c.margen_nuevo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => pedir(true)} disabled={trabajando || previa.resumen.cambian === 0}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {trabajando ? "Guardando…" : `Aplicar a ${previa.resumen.cambian} producto(s)`}
            </button>
            <button type="button" onClick={() => setPrevia(null)} disabled={trabajando}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Listado */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {isAdmin && <th className="px-3 py-3 w-8" />}
                <th className="px-4 py-3 font-semibold">Producto</th>
                <th className="px-4 py-3 font-semibold">Rubro</th>
                <th className="px-4 py-3 font-semibold text-right">Stock</th>
                <th className="px-4 py-3 font-semibold text-right">Costo de compra</th>
                <th className="px-4 py-3 font-semibold text-right">Precio</th>
                <th className="px-4 py-3 font-semibold text-right">Margen</th>
                <th className="px-4 py-3 font-semibold text-right">Remarcación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {cargando ? (
                <tr><td colSpan={isAdmin ? 8 : 7} className="py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={isAdmin ? 8 : 7} className="py-12 text-center text-slate-400">No hay productos con esos filtros.</td></tr>
              ) : (
                filas.map((f) => {
                  const bajoCosto = f.costo > 0 && f.precio > 0 && f.precio < f.costo;
                  return (
                    <tr key={f.id} className={bajoCosto ? "bg-rose-50/40" : "hover:bg-slate-50"}>
                      {isAdmin && (
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={marcados.has(f.id)} onChange={() => alternar(f.id)}
                            aria-label={`Marcar ${f.nombre}`} />
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-slate-700">
                        <Link href={`/inventario/${f.id}`} className="hover:text-[#4FAEB2] hover:underline">{f.nombre}</Link>
                        <div className="font-mono text-[11px] text-slate-400">{f.sku}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{f.rubro}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{gs(f.stock)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {f.costo > 0 ? gs(f.costo) : <span className="text-amber-600">sin costo</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{gs(f.precio)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${colorMargen(f.margen)}`}>{pct(f.margen)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{pct(f.remarcacion)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-slate-400">
        <strong>Margen</strong> es qué parte de la venta queda como ganancia;{" "}
        <strong>remarcación</strong> es cuánto se le puso encima al costo. Es la misma plata mirada
        desde dos lados: 150% de remarcación son 60% de margen. Las filas en rojo se venden por
        debajo del costo. El costo es el promedio ponderado de las compras.
      </p>
    </div>
  );
}
