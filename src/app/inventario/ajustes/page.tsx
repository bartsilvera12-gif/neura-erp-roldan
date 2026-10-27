"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccionesTabla from "@/components/ui/AccionesTabla";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Historial de ajustes de stock (punto 1.4).
 *
 * Aparte de Movimientos a propósito: acá solo está lo que cambió el stock sin
 * una compra ni una venta detrás. Mezclado con las ventas del día un ajuste se
 * pierde; separado, se ve de una quién tocó el stock, cuánto y por qué.
 */

type Ajuste = {
  id: string;
  numero: string | null;
  fecha: string;
  producto_id: string | null;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  /** Con signo. null = no se pudo determinar (ajuste viejo, motivo a mano). */
  delta: number | null;
  stock_antes: number | null;
  stock_despues: number | null;
  costo_unitario: number;
  motivo: string;
  usuario: string;
};

type Respuesta = {
  ajustes: Ajuste[];
  total: number;
  migrado: boolean;
  resumen: { unidades_sumadas: number; unidades_restadas: number; sin_signo: number };
};

const num = (n: number) => Number(n || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Fecha y hora en hora de Paraguay (UTC−3), sin depender de la tzdata. */
function fechaHoraPy(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { fecha: "—", hora: "" };
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`,
    hora: `${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`,
  };
}

/** Hoy en Paraguay, como YYYY-MM-DD, para los inputs de fecha. */
function hoyPy(): string {
  const py = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${py.getUTCFullYear()}-${p(py.getUTCMonth() + 1)}-${p(py.getUTCDate())}`;
}

function haceDiasPy(dias: number): string {
  const py = new Date(Date.now() - 3 * 60 * 60 * 1000 - dias * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${py.getUTCFullYear()}-${p(py.getUTCMonth() + 1)}-${p(py.getUTCDate())}`;
}

export default function AjustesPage() {
  // Arranca en el último mes: el historial completo de entrada no deja ver
  // nada, y lo que se revisa casi siempre es lo reciente.
  const [desde, setDesde] = useState(() => haceDiasPy(30));
  const [hasta, setHasta] = useState(() => hoyPy());
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState("");
  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([]);
  const [qDraft, setQDraft] = useState("");
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (desde) sp.set("desde", desde);
      if (hasta) sp.set("hasta", hasta);
      if (q) sp.set("q", q);
      if (categoria) sp.set("categoria", categoria);
      sp.set("limit", "500");
      const r = await fetchWithSupabaseSession(`/api/inventario/ajustes?${sp}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el historial.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, q, categoria]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Catálogo de rubros para el filtro. Un ajuste guarda el producto, no el
  // rubro, así que el filtrado lo hace el servidor; acá solo se eligen.
  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/inventario/categorias", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        const rows = ((j?.data?.categorias ?? []) as Record<string, unknown>[])
          .map((c) => ({ id: String(c.id), nombre: String(c.nombre ?? "") }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setRubros(rows);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  const ajustes = data?.ajustes ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/inventario" className="text-xs font-medium text-slate-500 hover:text-slate-800">
            ← Volver a inventario
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Ajustes de stock</h1>
          <p className="text-sm text-slate-500">
            Todo lo que cambió el stock sin una compra ni una venta detrás.
          </p>
        </div>
        {/* Requisito 11.1: lo que se ve se puede sacar a Excel. */}
        <AccionesTabla
          titulo="Ajustes de stock"
          archivo={`ajustes-${desde || "inicio"}_${hasta || "hoy"}`}
          subtitulo={desde || hasta ? `Del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
          columnas={["Código", "Fecha", "Hora", "Producto", "SKU", "Cantidad", "Stock antes", "Stock después", "Motivo", "Usuario"]}
          filas={ajustes.map((a) => {
            const { fecha, hora } = fechaHoraPy(a.fecha);
            return [
              a.numero ?? "",
              fecha,
              hora,
              a.producto_nombre,
              a.producto_sku ?? "",
              // Sin signo conocido se exporta el valor absoluto con "?", igual
              // que en pantalla: inventar el signo seria peor que no saberlo.
              a.delta == null ? `? ${a.cantidad}` : a.delta,
              a.stock_antes ?? "",
              a.stock_despues ?? "",
              a.motivo ?? "",
              a.usuario ?? "",
            ];
          })}
        />
      </div>

      {data && !data.migrado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falta correr <code className="font-mono">19_historial_ajustes.sql</code> en la base.
          Mientras tanto los ajustes no tienen código y el signo se deduce del tipo de
          movimiento, así que puede faltar en algunos.
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Desde</span>
          <input
            type="date" value={desde} max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Hasta</span>
          <input
            type="date" value={hasta} min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Rubro</span>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="min-w-[160px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todos los rubros</option>
            {rubros.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
            ))}
          </select>
        </label>
        <form
          className="flex flex-1 flex-col gap-1"
          onSubmit={(e) => { e.preventDefault(); setQ(qDraft.trim()); }}
        >
          <span className="text-[11px] font-semibold uppercase text-slate-500">Buscar</span>
          <div className="flex gap-2">
            <input
              type="text" value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Producto, motivo, usuario o código…"
              className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
            >
              Buscar
            </button>
          </div>
        </form>
        <button
          type="button"
          onClick={() => { setDesde(haceDiasPy(30)); setHasta(hoyPy()); setQ(""); setQDraft(""); setCategoria(""); }}
          className="pb-2 text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
        >
          Limpiar
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tarjeta label="Ajustes" valor={String(data.total)} />
          <Tarjeta label="Unidades sumadas" valor={`+${num(data.resumen.unidades_sumadas)}`} tono="verde" />
          <Tarjeta label="Unidades restadas" valor={`−${num(data.resumen.unidades_restadas)}`} tono="rojo" />
          <Tarjeta
            label="Sin signo"
            valor={String(data.resumen.sin_signo)}
            sub={data.resumen.sin_signo > 0 ? "ajustes viejos, no se puede saber" : "todos identificados"}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Hora</th>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Usuario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">Cargando…</td></tr>
              ) : ajustes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    No hay ajustes en ese período.
                  </td>
                </tr>
              ) : (
                ajustes.map((a) => {
                  const { fecha, hora } = fechaHoraPy(a.fecha);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-500">
                        {a.numero ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-700">{fecha}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500">{hora}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{a.producto_nombre}</p>
                        {a.producto_sku && (
                          <p className="font-mono text-[11px] text-slate-400">{a.producto_sku}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {a.delta == null ? (
                          <span className="text-slate-400" title="Este ajuste es anterior al registro del signo: no se puede saber si sumó o restó.">
                            ? {num(a.cantidad)}
                          </span>
                        ) : (
                          <span className={a.delta > 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                            {a.delta > 0 ? "+" : "−"}{num(Math.abs(a.delta))}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {a.stock_antes == null || a.stock_despues == null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <>{num(a.stock_antes)} → <b className="text-slate-700">{num(a.stock_despues)}</b></>
                        )}
                      </td>
                      <td className="max-w-[280px] px-4 py-2.5 text-slate-600">{a.motivo || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{a.usuario || "—"}</td>
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
          Acá entra todo lo que cambió el stock sin respaldo de una compra o una venta: los
          ajustes de la pantalla de Movimientos, los que se hacen editando el stock en la ficha
          del producto y las correcciones que trae una importación de Excel. Las ventas, las
          compras y la carga inicial no son ajustes y no aparecen.
        </p>
        <p>
          <strong>Sin signo</strong> son ajustes anteriores a este cambio cuyo motivo fue escrito
          a mano. El sistema guardaba solo el valor absoluto, así que no hay forma de saber si
          sumaron o restaron. Se muestran con &quot;?&quot; en vez de adivinar.
        </p>
      </div>
    </div>
  );
}

function Tarjeta({
  label, valor, sub, tono = "neutro",
}: {
  label: string; valor: string; sub?: string; tono?: "neutro" | "verde" | "rojo";
}) {
  const color =
    tono === "verde" ? "text-emerald-600" : tono === "rojo" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
