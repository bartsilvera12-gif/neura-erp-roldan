"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import AccionesTabla from "@/components/ui/AccionesTabla";

/**
 * Historial de tipos de cambio (punto 7.2).
 *
 * "Historial por fecha y hora, con usuario responsable y filtros. No
 * sobrescribir cotizaciones ya usadas."
 *
 * NO HAY BOTÓN DE EDITAR NI DE BORRAR, Y ES A PROPÓSITO
 *   Una cotización vieja es la que se usó para costear las compras de ese día.
 *   Si se pudiera corregir, el costo de esas compras cambiaría solo y los
 *   informes dejarían de coincidir con las facturas en papel. Para corregir
 *   una cotización se carga otra: la anterior queda, con su fecha y su autor.
 *
 * LA COLUMNA "VARIACIÓN"
 *   Compara contra la cotización anterior de la lista. Es el dato que se mira
 *   para notar un error de tipeo: un salto del 30% en un día casi siempre es
 *   un cero de más, no el mercado.
 */

type Cotizacion = {
  id: string;
  moneda: string;
  compra: number;
  venta: number;
  vigente_desde: string;
  usuario_nombre: string | null;
  observacion: string | null;
};

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function fechaHoraPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

export default function TiposCambioPage() {
  const { isAdmin } = useIsAdmin();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [usuario, setUsuario] = useState("");

  const [lista, setLista] = useState<Cotizacion[]>([]);
  const [vigente, setVigente] = useState<Cotizacion | null>(null);
  const [migrado, setMigrado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    const qs = new URLSearchParams({ moneda: "USD", limit: "300", incluir_futuras: "1" });
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    if (usuario.trim()) qs.set("usuario", usuario.trim());
    try {
      const res = await fetchWithSupabaseSession(`/api/tipos-cambio?${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j?.success) {
        setErrorCarga(String(j?.error ?? "No se pudo cargar el historial."));
        setLista([]);
        return;
      }
      setLista((j.data?.historial ?? []) as Cotizacion[]);
      setVigente((j.data?.vigente ?? null) as Cotizacion | null);
      setMigrado(j.data?.migrado !== false);
    } catch {
      setErrorCarga("No se pudo cargar el historial.");
      setLista([]);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const ahora = new Date().toISOString();

  // La variación se calcula contra la fila siguiente, que es la cotización
  // anterior en el tiempo (la lista viene de la más nueva a la más vieja).
  const filas = useMemo(
    () =>
      lista.map((c, i) => {
        const prev = lista[i + 1];
        const varVenta =
          prev && prev.venta > 0 ? ((c.venta - prev.venta) / prev.venta) * 100 : null;
        return { ...c, varVenta, futura: c.vigente_desde > ahora };
      }),
    [lista, ahora]
  );

  const limpiar = () => { setDesde(""); setHasta(""); setUsuario(""); };
  const hayFiltros = Boolean(desde || hasta || usuario.trim());

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-800">Tipos de cambio</h1>
        <p className="text-sm text-slate-500">
          Cada cotización queda registrada con su fecha, su hora y quién la cargó.
          Para corregir una se carga otra: las anteriores no se tocan porque son
          las que se usaron para costear las compras de ese día.
        </p>
      </header>

      {!migrado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falta correr <code className="font-mono">20_tipos_cambio.sql</code> en la base.
        </div>
      )}

      {vigente && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Comprador vigente
            </div>
            <div className="text-2xl font-semibold text-slate-800">{fmt(vigente.compra)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Vendedor vigente
            </div>
            <div className="text-2xl font-semibold text-slate-800">{fmt(vigente.venta)}</div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Usuario</label>
            <input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)}
              placeholder="Quién la cargó"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none" />
          </div>
        </div>
        {hayFiltros && (
          <button type="button" onClick={limpiar}
            className="mt-3 text-xs text-slate-400 underline transition-colors hover:text-slate-700">
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Historial</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{filas.length} cotizaciones</span>
            {/* Requisito 11.1. */}
            <AccionesTabla
              titulo="Tipos de cambio"
              archivo={`tipos-cambio-${desde || "inicio"}_${hasta || "hoy"}`}
              subtitulo={desde || hasta ? `Del ${desde || "inicio"} al ${hasta || "hoy"}` : undefined}
              columnas={["Fecha y hora", "Comprador", "Vendedor", "Usuario", "Observación"]}
              filas={filas.map((c) => [
                fechaHoraPy(c.vigente_desde),
                c.compra,
                c.venta,
                c.usuario_nombre ?? "",
                c.observacion ?? "",
              ])}
            />
          </div>
        </div>

        {errorCarga && <p className="py-6 text-center text-sm text-red-600">{errorCarga}</p>}

        {!errorCarga && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-600">
                  <th className="py-3 pr-4 font-semibold">Fecha y hora</th>
                  <th className="py-3 pr-4 font-semibold">Comprador</th>
                  <th className="py-3 pr-4 font-semibold">Vendedor</th>
                  <th className="py-3 pr-4 font-semibold">Variación</th>
                  <th className="py-3 pr-4 font-semibold">Usuario</th>
                  <th className="py-3 font-semibold">Observación</th>
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr><td colSpan={6} className="py-12 text-center text-slate-400">Cargando…</td></tr>
                ) : filas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      {hayFiltros ? "Sin cotizaciones para esos filtros." : "Todavía no se cargó ninguna cotización."}
                    </td>
                  </tr>
                ) : (
                  filas.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap text-slate-700">
                        {fechaHoraPy(c.vigente_desde)}
                        {c.futura && (
                          <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            todavía no rige
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-700">{fmt(c.compra)}</td>
                      <td className="py-3 pr-4 font-mono font-medium text-slate-800">{fmt(c.venta)}</td>
                      <td className="py-3 pr-4 text-xs">
                        {c.varVenta == null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={
                              Math.abs(c.varVenta) >= 10
                                ? "font-medium text-amber-600"
                                : c.varVenta > 0
                                ? "text-slate-600"
                                : c.varVenta < 0
                                ? "text-slate-600"
                                : "text-slate-400"
                            }
                          >
                            {c.varVenta > 0 ? "+" : ""}
                            {c.varVenta.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{c.usuario_nombre ?? "—"}</td>
                      <td className="py-3 text-slate-500">{c.observacion ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isAdmin && (
          <p className="mt-3 text-xs text-slate-400">
            Para cargar una cotización nueva hace falta permiso de administrador.
            Se hace desde el Dashboard.
          </p>
        )}
      </div>
    </div>
  );
}
