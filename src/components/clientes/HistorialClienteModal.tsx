"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Historial comercial del cliente (punto 3.3).
 *
 * Se abre desde Caja con el cliente ya elegido, que es cuando hace falta: el
 * cliente está en el mostrador preguntando cuánto salió la última vez o de qué
 * medida se llevó.
 *
 * Las ventas anuladas se listan —para que no parezca que falta una— pero no
 * cuentan en los totales: no son plata que entró.
 */

type ItemHist = {
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  total_linea: number;
};

type VentaHist = {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  estado: string | null;
  tipo_venta: string | null;
  metodo_pago: string | null;
  tiene_factura: boolean;
  items: ItemHist[];
};

type Respuesta = {
  ventas: VentaHist[];
  resumen: {
    operaciones: number;
    anuladas: number;
    total_comprado: number;
    promedio: number;
    ultima_compra: string | null;
    mas_llevados: { nombre: string; veces: number; unidades: number }[];
  };
};

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Fecha y hora en hora de Paraguay (UTC−3), sin depender de la tzdata. */
function fechaPy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(py.getUTCDate())}/${p(py.getUTCMonth() + 1)}/${py.getUTCFullYear()} ${p(py.getUTCHours())}:${p(py.getUTCMinutes())}`;
}

export default function HistorialClienteModal({
  clienteId,
  clienteNombre,
  onClose,
}: {
  clienteId: string;
  clienteNombre: string;
  onClose: () => void;
}) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (desde) sp.set("desde", desde);
      if (hasta) sp.set("hasta", hasta);
      const r = await fetchWithSupabaseSession(
        `/api/clientes/${clienteId}/historial?${sp}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el historial.");
      setData(j.data as Respuesta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [clienteId, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  const r = data?.resumen;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              Historial de {clienteNombre}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Todo lo que le vendimos. Las anuladas se listan pero no suman.
            </p>
          </div>
          <button
            type="button" onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Desde</span>
            <input type="date" value={desde} max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Hasta</span>
            <input type="date" value={hasta} min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
          </label>
          {(desde || hasta) && (
            <button type="button" onClick={() => { setDesde(""); setHasta(""); }}
              className="pb-1.5 text-xs text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline">
              Ver todo
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {r && (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tarjeta label="Compró" valor={gs(r.total_comprado)} destacado />
              <Tarjeta label="Operaciones" valor={String(r.operaciones)}
                sub={r.anuladas > 0 ? `${r.anuladas} anulada${r.anuladas === 1 ? "" : "s"}` : undefined} />
              <Tarjeta label="Promedio" valor={gs(r.promedio)} />
              <Tarjeta label="Última compra"
                valor={r.ultima_compra ? fechaPy(r.ultima_compra).split(" ")[0] : "—"} />
            </div>
          )}

          {r && r.mas_llevados.length > 0 && (
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Lo que más lleva
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.mas_llevados.map((p) => (
                  <span key={p.nombre} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200">
                    {p.nombre}
                    <span className="ml-1 text-slate-400">×{p.veces}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {cargando ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : (data?.ventas.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {desde || hasta ? "No le vendimos nada en ese período." : "Todavía no le vendimos nada."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {data!.ventas.map((v) => {
                const anulada = v.estado === "anulada";
                const abierto = abierta === v.id;
                return (
                  <div key={v.id} className={`overflow-hidden rounded-lg border ${anulada ? "border-slate-200 bg-slate-50/60" : "border-slate-200"}`}>
                    <button
                      type="button"
                      onClick={() => setAbierta(abierto ? null : v.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="font-mono text-[11px] text-slate-500">{v.numero_control}</span>
                      <span className="text-xs text-slate-500">{fechaPy(v.fecha)}</span>
                      {anulada && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 ring-1 ring-rose-200">
                          Anulada
                        </span>
                      )}
                      {v.tipo_venta === "CREDITO" && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          Crédito
                        </span>
                      )}
                      <span className={`ml-auto text-sm font-bold tabular-nums ${anulada ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {gs(v.total)}
                      </span>
                      <span className="text-slate-300">{abierto ? "▾" : "▸"}</span>
                    </button>
                    {abierto && (
                      <div className="border-t border-slate-100 bg-white px-3 py-2">
                        {v.items.length === 0 ? (
                          <p className="py-1 text-xs text-slate-400">Sin detalle de productos.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-slate-50">
                              {v.items.map((i, idx) => (
                                <tr key={idx}>
                                  <td className="py-1 text-slate-700">
                                    {i.producto_nombre}
                                    {i.sku && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{i.sku}</span>}
                                  </td>
                                  <td className="py-1 text-right tabular-nums text-slate-500">×{i.cantidad}</td>
                                  <td className="py-1 text-right tabular-nums text-slate-500">{gs(i.precio_venta)}</td>
                                  <td className="py-1 text-right tabular-nums font-medium text-slate-700">{gs(i.total_linea)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tarjeta({ label, valor, sub, destacado = false }: {
  label: string; valor: string; sub?: string; destacado?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white p-2.5 ${destacado ? "border-[#4FAEB2]/40" : "border-slate-200"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${destacado ? "text-[#3F8E91]" : "text-slate-900"}`}>{valor}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
