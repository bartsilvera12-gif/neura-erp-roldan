"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Las últimas compras del cliente, en Gestión de clientes (pedido del
 * cliente): qué llevó, cuándo y a qué precio, sin salir del panel.
 *
 * Sale de /api/clientes/[id]/historial, el mismo que usa la ficha del
 * cliente. Si falla, el bloque no se muestra: el panel sigue sirviendo.
 */

type Item = { producto_nombre: string; sku: string | null; cantidad: number; precio_venta: number; total_linea: number };
type Venta = {
  id: string; numero_control: string; fecha: string; total: number; estado: string | null;
  tipo_venta: string | null; items: Item[];
};
type Resumen = {
  operaciones: number; anuladas: number; total_comprado: number; promedio: number;
  ultima_compra: string | null; mas_llevados: Array<{ nombre: string; veces: number; unidades: number }>;
};

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const cant = (n: number) => (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const MOSTRAR = 10;

export default function UltimasComprasCliente({ clienteId }: { clienteId: string }) {
  const [ventas, setVentas] = useState<Venta[] | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setVentas(null);
    setResumen(null);
    setFallo(false);
    setDetalle(null);
    fetchWithSupabaseSession(`/api/clientes/${clienteId}/historial?limite=${MOSTRAR}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.success) { setFallo(true); return; }
        setVentas((j.data?.ventas ?? []) as Venta[]);
        setResumen((j.data?.resumen ?? null) as Resumen | null);
      })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [clienteId]);

  if (fallo) return null;

  return (
    <section className="border-b border-slate-200/80">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-slate-50/90 px-3 py-2.5 text-left hover:bg-slate-100/90 sm:px-4"
      >
        <span className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-600">
          {abierto ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          <ShoppingBag className="h-3.5 w-3.5 text-slate-500" /> Últimas compras
        </span>
        {resumen && (
          <span className="text-[11px] text-slate-500">
            Última {fecha(resumen.ultima_compra)}
          </span>
        )}
      </button>

      {abierto && (
        <div className="space-y-3 px-3 py-3 sm:px-4">
          {ventas == null ? (
            <p className="text-xs text-slate-400 animate-pulse">Buscando las compras…</p>
          ) : ventas.length === 0 ? (
            <p className="text-xs text-slate-400">Este cliente todavía no compró nada en esta sucursal.</p>
          ) : (
            <>
              {resumen && resumen.mas_llevados.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  Lo que más lleva:{" "}
                  {resumen.mas_llevados.slice(0, 3).map((m) => `${m.nombre} (${m.veces}×)`).join(" · ")}
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                      <th className="px-3 py-2 text-left font-semibold">N° venta</th>
                      <th className="px-3 py-2 text-left font-semibold">Qué llevó</th>
                      <th className="px-3 py-2 text-left font-semibold">Condición</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ventas.map((v) => {
                      const anulada = v.estado === "anulada";
                      const abiertaFila = detalle === v.id;
                      return (
                        <Fragment key={v.id}>
                          <tr
                            onClick={() => setDetalle(abiertaFila ? null : v.id)}
                            className={`cursor-pointer ${anulada ? "text-slate-400 line-through" : "hover:bg-slate-50"}`}
                            title="Ver qué llevó y a qué precio"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">{fecha(v.fecha)}</td>
                            <td className="px-3 py-2 font-mono">{v.numero_control}</td>
                            <td className="px-3 py-2">
                              <span className="block max-w-[16rem] truncate">
                                {v.items[0] ? `${cant(v.items[0].cantidad)} × ${v.items[0].producto_nombre}` : "—"}
                              </span>
                              {v.items.length > 1 && <span className="text-[10px] text-slate-400">y {v.items.length - 1} más</span>}
                            </td>
                            <td className="px-3 py-2">{v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{gs(v.total)}</td>
                          </tr>
                          {abiertaFila && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={5} className="px-3 py-2">
                                <table className="w-full text-[11px]">
                                  <tbody>
                                    {v.items.map((i, k) => (
                                      <tr key={k}>
                                        <td className="py-0.5 pr-2 text-slate-700">{i.producto_nombre}</td>
                                        <td className="py-0.5 pr-2 text-right tabular-nums">{cant(i.cantidad)}</td>
                                        <td className="py-0.5 pr-2 text-right tabular-nums text-slate-500">a {gs(i.precio_venta)}</td>
                                        <td className="py-0.5 text-right font-medium tabular-nums">{gs(i.total_linea)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                {resumen && (
                  <span>
                    Estas {resumen.operaciones} suman {gs(resumen.total_comprado)} · promedio {gs(resumen.promedio)}
                  </span>
                )}
                <Link href={`/clientes/${clienteId}`} className="font-medium text-[#3F8E91] hover:underline">
                  Ver todas en la ficha →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
