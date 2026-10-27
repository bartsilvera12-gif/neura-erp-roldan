"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Qué se vendió en una venta, y todo lo que le pasó después.
 *
 * ── POR QUÉ UN SOLO COMPONENTE ────────────────────────────────────────────
 *   La misma pregunta —"¿qué tiene esta venta?"— aparece en el historial de
 *   ventas y en el detalle del cierre de caja. Con dos pantallas distintas,
 *   una terminaría mostrando la devolución y la otra no, y nadie se enteraría
 *   hasta que los números no cierren.
 *
 *   Los ítems ya vienen con la venta en el listado, así que se pintan al
 *   instante. Las ediciones y las devoluciones se piden recién al abrir: casi
 *   ninguna venta tiene, y traerlas para todas sería pagar dos consultas
 *   grandes cada vez que alguien entra a la pantalla.
 */

export interface VentaItemLite {
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  precio_venta: number;
  precio_venta_original?: number | null;
  tipo_iva?: string | null;
  total_linea: number;
}

export interface VentaDetalleLite {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  subtotal?: number;
  monto_iva?: number;
  estado?: string | null;
  tipo_venta?: string | null;
  metodo_pago?: string | null;
  cliente_nombre?: string | null;
  vendedor_nombre?: string | null;
  usuario_nombre?: string | null;
  numero_factura?: string | null;
  anulacion_motivo?: string | null;
  items?: VentaItemLite[];
}

interface Cambio { campo?: string; antes?: string | null; despues?: string | null }
interface Edicion {
  fecha: string;
  usuario_nombre: string | null;
  motivo: string | null;
  total_antes: number;
  total_despues: number;
  cambios: Cambio[];
}
interface DevolucionItem { producto_nombre: string; sku: string | null; cantidad: number; total: number; condicion: string | null }
interface Devolucion {
  id: string;
  numero: string | null;
  fecha: string;
  tipo: string | null;
  resolucion: string | null;
  estado: string | null;
  motivo: string | null;
  total_devuelto: number;
  usuario_nombre: string | null;
  anulada_at: string | null;
  items: DevolucionItem[];
}

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const cant = (n: number) => Number(n ?? 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Paraguay es UTC−3 todo el año. */
function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", cheque: "Cheque", mixto: "Pago mixto",
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      {children}
    </section>
  );
}

export default function DetalleVentaModal({
  venta,
  onClose,
}: {
  venta: VentaDetalleLite;
  onClose: () => void;
}) {
  const [ediciones, setEdiciones] = useState<Edicion[]>([]);
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    fetchWithSupabaseSession(`/api/ventas/${venta.id}/historial`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancel) return;
        if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el historial.");
        setEdiciones((j.data?.ediciones ?? []) as Edicion[]);
        setDevoluciones((j.data?.devoluciones ?? []) as Devolucion[]);
      })
      .catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : "Error de red."); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [venta.id]);

  // Escape cierra: el modal se abre haciendo clic en una fila, y la salida
  // tiene que estar donde la mano ya está.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const anulada = venta.estado === "anulada";
  const items = venta.items ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Venta {venta.numero_control}
              {venta.numero_factura && (
                <span className="ml-2 text-sm font-normal text-slate-500">Factura {venta.numero_factura}</span>
              )}
            </h2>
            <p className="text-sm text-slate-500">
              {fechaHora(venta.fecha)} · {venta.cliente_nombre || "Consumidor final"}
            </p>
            {anulada && (
              <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                ANULADA{venta.anulacion_motivo ? ` — ${venta.anulacion_motivo}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/ventas/${venta.id}/comprobante-a4`}
              target="_blank" rel="noopener"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
            >
              Imprimir
            </a>
            <button
              type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </header>

        <div className="space-y-5 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Vendedor</p>
              <p className="font-medium text-slate-800">{venta.vendedor_nombre || venta.usuario_nombre || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Cajero</p>
              <p className="font-medium text-slate-800">{venta.usuario_nombre || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Condición</p>
              <p className="font-medium text-slate-800">{venta.tipo_venta ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Medio de pago</p>
              <p className="font-medium text-slate-800">{MEDIO[venta.metodo_pago ?? ""] ?? venta.metodo_pago ?? "—"}</p>
            </div>
          </div>

          <Seccion titulo="Qué se vendió">
            {items.length === 0 ? (
              <p className="text-sm text-slate-400">No se cargaron los productos de esta venta.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Producto</th>
                      <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                      <th className="px-3 py-2 text-right font-semibold">Precio</th>
                      <th className="px-3 py-2 text-center font-semibold">IVA</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((i, n) => {
                      const lista = Number(i.precio_venta_original ?? 0);
                      const conDesc = lista > 0 && lista > i.precio_venta;
                      return (
                        <tr key={n}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{i.producto_nombre}</p>
                            {i.sku && <p className="font-mono text-[11px] text-slate-400">{i.sku}</p>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">{cant(i.cantidad)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {gs(i.precio_venta)}
                            {/* El precio de lista se muestra solo cuando hubo
                                descuento: si no, repetir el mismo número en dos
                                renglones hace dudar de cuál se cobró. */}
                            {conDesc && (
                              <span className="block text-[11px] text-slate-400 line-through">{gs(lista)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-slate-500">{i.tipo_iva ?? ""}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{gs(i.total_linea)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 text-sm">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-slate-500">
                        IVA {venta.monto_iva != null ? gs(venta.monto_iva) : ""}
                      </td>
                      <td className="px-3 py-2 text-right text-base font-bold text-slate-900">{gs(venta.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Seccion>

          {error && <p className="text-sm text-rose-700">{error}</p>}
          {cargando && <p className="text-sm text-slate-400">Buscando ediciones y devoluciones…</p>}

          {!cargando && !error && (
            <>
              <Seccion titulo={`Ediciones (${ediciones.length})`}>
                {ediciones.length === 0 ? (
                  <p className="text-sm text-slate-400">Esta venta no se editó.</p>
                ) : (
                  <ul className="space-y-2">
                    {ediciones.map((e, n) => (
                      <li key={n} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
                        <p className="font-medium text-slate-800">
                          {fechaHora(e.fecha)} · {e.usuario_nombre || "—"}
                        </p>
                        <p className="text-slate-700">
                          Motivo: {e.motivo || <span className="text-slate-400">sin motivo escrito</span>}
                        </p>
                        {e.total_antes !== e.total_despues && (
                          <p className="text-slate-600">Total: {gs(e.total_antes)} → <strong>{gs(e.total_despues)}</strong></p>
                        )}
                        {e.cambios.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-slate-600">
                            {e.cambios.map((c, k) => (
                              <li key={k}>
                                <strong>{c.campo ?? "Cambio"}</strong>
                                {c.antes || c.despues ? `: ${c.antes ?? "—"} → ${c.despues ?? "—"}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Seccion>

              <Seccion titulo={`Devoluciones (${devoluciones.length})`}>
                {devoluciones.length === 0 ? (
                  <p className="text-sm text-slate-400">Esta venta no tiene devoluciones.</p>
                ) : (
                  <ul className="space-y-2">
                    {devoluciones.map((d) => (
                      <li key={d.id} className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm">
                        <p className="font-medium text-slate-800">
                          {d.numero ?? "Devolución"} · {fechaHora(d.fecha)} · {d.usuario_nombre || "—"}
                          {d.anulada_at && <span className="ml-2 text-xs font-semibold text-rose-700">ANULADA</span>}
                        </p>
                        <p className="text-slate-700">
                          {d.tipo ?? ""} {d.resolucion ? `· ${d.resolucion}` : ""} · <strong>{gs(d.total_devuelto)}</strong>
                        </p>
                        <p className="text-slate-700">
                          Motivo: {d.motivo || <span className="text-slate-400">sin motivo escrito</span>}
                        </p>
                        {d.items.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-slate-600">
                            {d.items.map((i, k) => (
                              <li key={k}>
                                {cant(i.cantidad)} × {i.producto_nombre} — {gs(i.total)}
                                {i.condicion ? ` (${i.condicion})` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        <a
                          href={`/api/devoluciones/${d.id}/comprobante`}
                          target="_blank" rel="noopener"
                          className="mt-1 inline-block text-xs font-medium text-sky-800 underline underline-offset-2"
                        >
                          Ver comprobante
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Seccion>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
