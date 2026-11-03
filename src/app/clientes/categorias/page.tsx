"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Loader2, Users, History } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { periodoPy, rangoDePeriodo } from "@/lib/clientes/categoria-automatica";

/**
 * Historial de categorías de cliente.
 *
 * Dos vistas sobre el mismo período, porque son dos preguntas distintas:
 *
 *   Cambios      — a quién le cambió la categoría, de cuál a cuál y con cuánto.
 *   No compraron — quiénes no tuvieron una sola venta en esas fechas.
 *
 * El que no compró casi nunca aparece en el historial: si ya estaba en la
 * categoría más baja, no cambió nada y no hay renglón que registrar. Por eso es
 * un botón que cambia la consulta, y no un filtro de la tabla.
 */

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Paraguay es UTC−3 todo el año.
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()}`;
}

type Cambio = {
  id: string; fecha: string; cliente_id: string; cliente_nombre: string;
  cliente_ruc: string | null;
  categoria_anterior: string | null; categoria_nueva: string | null;
  periodo: string; monto_periodo: number; origen: string;
  motivo: string | null; usuario_nombre: string | null;
};
type SinCompra = {
  cliente_id: string; cliente_nombre: string; cliente_ruc: string | null;
  categoria: string | null; ultima_compra: string | null; dias_sin_comprar: number | null;
};
type Situacion = {
  cliente_id: string; cliente_nombre: string; cliente_ruc: string | null;
  categoria: string | null; monto_periodo: number; operaciones: number;
  ultima_compra: string | null;
};
type Respuesta = {
  modo: "cambios" | "sin_compras";
  desde: string; hasta: string;
  cambios: Cambio[];
  sin_compras: SinCompra[];
  situacion: Situacion[];
};
type CategoriaLite = { id: string; nombre: string; monto_minimo_mensual?: number | null };

export default function CategoriasClientePage() {
  const { isAdmin } = useIsAdmin();
  const mes = rangoDePeriodo(periodoPy())!;
  const [desde, setDesde] = useState(mes.desde);
  const [hasta, setHasta] = useState(mes.hasta);
  const [sinCompras, setSinCompras] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [cats, setCats] = useState<CategoriaLite[]>([]);
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculando, setRecalculando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/categorias-cliente")
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCats(j.data.categorias ?? []); })
      .catch(() => { /* el selector queda vacío; el informe igual anda */ });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ desde, hasta });
      if (categoria) qs.set("categoria", categoria);
      if (busqueda.trim()) qs.set("q", busqueda.trim());
      if (sinCompras) qs.set("sin_compras", "1");
      const r = await fetchWithSupabaseSession(`/api/clientes/categorias/historial?${qs}`);
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, categoria, sinCompras, busqueda]);

  useEffect(() => {
    // Espera a que termine de escribir: sin esto son seis consultas para
    // escribir "PEDRO".
    const id = setTimeout(() => { void cargar(); }, busqueda.trim() === "" ? 0 : 300);
    return () => clearTimeout(id);
  }, [cargar, busqueda]);

  async function recalcular() {
    // El recálculo se hace sobre el MES del "desde": las categorías se deciden
    // por mes calendario, así que un rango suelto no define un período.
    const periodo = desde.slice(0, 7);
    if (!window.confirm(
      `Se va a recalcular la categoría de todos los clientes según lo que compraron en ${periodo}. ` +
      `A los que cambien se les cambia el precio al que se les vende. ¿Seguir?`
    )) return;
    setRecalculando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession("/api/clientes/categorias/recalcular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo recalcular.");
      const d = j.data as { cambios: unknown[]; clientes_evaluados: number; aviso: string | null };
      setAviso(
        d.aviso ??
        `${d.cambios.length} cliente(s) cambiaron de categoría sobre ${d.clientes_evaluados} evaluados en ${periodo}.`
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setRecalculando(false);
    }
  }

  const conEscalera = cats.filter((c) => c.monto_minimo_mensual != null).length;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <Link href="/clientes" className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Clientes
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-800">Categorías de cliente</h1>
        <p className="text-slate-600">
          Cuándo le cambió la categoría a cada cliente y por cuánto compró ese mes.
        </p>
      </div>

      {cats.length > 0 && conEscalera === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Ninguna categoría tiene cargado el <b>mínimo mensual</b>, así que todavía no se mueve
          nadie solo.{" "}
          <Link href="/configuracion/categorias-cliente" className="underline">
            Cargalos acá
          </Link>.
        </div>
      )}

      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* Buscar por nombre o por RUC. El RUC se compara también sin puntos
            ni guiones: en la base conviven 1234567-8, 1.234.567-8 y 1234567, y
            escribirlo de una forma no encontraba al que quedó de otra. */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Cliente</span>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o RUC…"
            className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-500">
            {sinCompras ? "Categoría actual" : "Quedó en"}
          </span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>

        {/* El botón que pidió el pedido: los que no compraron en esas fechas. */}
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setSinCompras(false)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${
              !sinCompras ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Historial
          </button>
          <button
            type="button"
            onClick={() => setSinCompras(true)}
            className={`inline-flex items-center gap-1.5 border-l border-slate-200 px-3 py-2 text-xs font-semibold transition-colors ${
              sinCompras ? "bg-amber-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            No compra
          </button>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => void recalcular()}
            disabled={recalculando}
            title="Vuelve a decidir la categoría de todos los clientes según el mes del filtro 'Desde'"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-50"
          >
            {recalculando
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Recalcular {desde.slice(0, 7)}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{aviso}</div>
      )}

      {/* ── En qué categoría está cada cliente buscado ──────────────────
          El historial tiene un renglón por CAMBIO, así que un cliente que está
          en la misma categoría desde siempre no aparece. Buscarlo y que diga
          "ningún cambio" es cierto y no sirve: la pregunta era en qué categoría
          está y cuánto compró. */}
      {!sinCompras && busqueda.trim() !== "" && (data?.situacion.length ?? 0) > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">
              En qué categoría está{data!.situacion.length === 1 ? "" : "n"} ahora
            </p>
            <p className="text-[11px] leading-snug text-slate-500">
              Y cuánto compró en las fechas del filtro. Abajo, los cambios de categoría que hubo.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Cliente</th>
                  <th className="px-4 py-2.5">RUC</th>
                  <th className="px-4 py-2.5">Categoría actual</th>
                  <th className="px-4 py-2.5 text-right">Compró en el período</th>
                  <th className="px-4 py-2.5">Última compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data!.situacion.map((c) => (
                  <tr key={c.cliente_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <Link href={`/clientes/${c.cliente_id}`} className="hover:text-[#3F8E91] hover:underline">
                        {c.cliente_nombre || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{c.cliente_ruc || "—"}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#3F8E91]">{c.categoria ?? "Sin categoría"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {gs(c.monto_periodo)}
                      {c.operaciones > 0 && (
                        <span className="ml-1 text-[11px] font-normal text-slate-400">
                          ({c.operaciones} vta{c.operaciones === 1 ? "" : "s"})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.ultima_compra ? fechaCorta(c.ultima_compra) : (
                        <span className="text-slate-400">Nunca compró</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {sinCompras ? (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">RUC</th>
                  <th className="px-4 py-3">Categoría actual</th>
                  <th className="px-4 py-3">Última compra</th>
                  <th className="px-4 py-3 text-right">Días sin comprar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cargando ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">Buscando…</td></tr>
                ) : (data?.sin_compras.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    Todos los clientes compraron en esas fechas.
                  </td></tr>
                ) : data!.sin_compras.map((c) => (
                  <tr key={c.cliente_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <Link href={`/clientes/${c.cliente_id}`} className="hover:text-[#3F8E91] hover:underline">
                        {c.cliente_nombre || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{c.cliente_ruc || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{c.categoria ?? "Sin categoría"}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.ultima_compra ? fechaCorta(c.ultima_compra) : (
                        <span className="text-slate-400">Nunca compró</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c.dias_sin_comprar == null ? "—" : (
                        <span className={c.dias_sin_comprar > 180 ? "font-semibold text-amber-700" : "text-slate-600"}>
                          {c.dias_sin_comprar}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">De</th>
                  <th className="px-4 py-3">A</th>
                  <th className="px-4 py-3">Mes</th>
                  <th className="px-4 py-3 text-right">Compró en el mes</th>
                  <th className="px-4 py-3">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cargando ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Buscando…</td></tr>
                ) : (data?.cambios.length ?? 0) === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    {busqueda.trim() === ""
                      ? "Ningún cambio de categoría en esas fechas."
                      : "Este cliente no cambió de categoría en esas fechas. Arriba está en cuál se encuentra hoy."}
                  </td></tr>
                ) : data!.cambios.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60" title={c.motivo ?? ""}>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{fechaCorta(c.fecha)}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <Link href={`/clientes/${c.cliente_id}`} className="hover:text-[#3F8E91] hover:underline">
                        {c.cliente_nombre || "—"}
                      </Link>
                      {c.cliente_ruc && (
                        <span className="ml-2 text-[11px] tabular-nums text-slate-400">{c.cliente_ruc}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{c.categoria_anterior ?? "Sin categoría"}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#3F8E91]">{c.categoria_nueva ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{c.periodo}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{gs(c.monto_periodo)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {c.origen === "manual" ? "A mano" : "Automático"}
                      {c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        La categoría sale de sumar lo facturado al cliente en el mes, sin las ventas anuladas, y
        quedarse con la categoría cuyo mínimo mensual ese monto alcanza. Sube apenas se cierra la
        venta que cruza el monto; <strong>baja en el recálculo de fin de mes</strong>, porque el que
        dejó de comprar no dispara ninguna venta que lo haga bajar solo. Las categorías sin mínimo
        cargado se asignan a mano y el automático no las toca.
      </p>
    </div>
  );
}
