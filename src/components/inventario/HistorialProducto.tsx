"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Lo que va debajo del detalle de un producto (pedido del cliente): el precio
 * para cada tipo de cliente y el historial completo — compras, ventas,
 * transferencias, remisiones, movimientos de stock y cambios de precio.
 */

type Compra = {
  fecha: string | null; numero_compra: string | null; numero_factura: string | null; proveedor: string | null;
  cantidad: number; moneda: string; tipo_cambio: number | null; estado: string | null; anulacion_motivo: string | null;
  usuario: string | null; costo_tipeado?: number | null; costo_gs?: number; costo_usd?: number | null;
  precio_venta?: number | null; precio_venta_usd?: number | null;
};
type Venta = {
  fecha: string | null; numero_venta: string | null; cliente: string; cantidad: number; precio: number; precio_lista: number;
  total: number; condicion: string; vendedor: string | null; anulada: boolean;
};
type Transf = { fecha: string | null; numero: string | null; estado: string | null; de: string; a: string; sentido: string; cantidad: number; pidio: string | null; despacho: string | null; recibio: string | null };
type Remision = { fecha: string | null; numero: string | null; estado: string | null; de: string; a: string; cantidad: number; motivo: string | null; quien: string | null };
type Mov = { fecha: string | null; tipo: string | null; origen: string | null; cantidad: number; referencia: string | null; usuario: string | null; costo_unitario?: number };
type CambioPrecio = { fecha: string | null; anterior: number | null; nuevo: number; como: string; usuario: string | null };
type PrecioCliente = { tipo: string; ajuste_pct: number | null; precio: number; fuente: string };

type Datos = {
  ver_costos: boolean;
  cotizacion_usd: number | null;
  precio_lista: number;
  precio_usd: number | null;
  precios_cliente: PrecioCliente[];
  ultimo_proveedor: string | null;
  ultima_compra: Compra | null;
  ultimo_cliente: string | null;
  compras: Compra[];
  ventas: Venta[];
  transferencias: Transf[];
  remisiones: Remision[];
  movimientos: Mov[];
  cambios_precio: CambioPrecio[];
};

const gs = (v: number | null | undefined) => (v == null ? "—" : `Gs. ${Math.round(v).toLocaleString("es-PY")}`);
const usd = (v: number | null | undefined) =>
  v == null || !(v > 0) ? "—" : `US$ ${v.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (v: number) => v.toLocaleString("es-PY", { maximumFractionDigits: 3 });
/** dd/mm/aaaa en hora de Paraguay. */
function fecha(iso: string | null): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const ORIGEN: Record<string, string> = {
  compra: "Compra", venta: "Venta", ajuste_manual: "Ajuste", inventario_inicial: "Inventario inicial",
  anulacion_venta: "Anulación de venta", anulacion_compra: "Anulación de compra", produccion: "Producción",
  edicion_venta: "Edición de venta", edicion_venta_reversa: "Edición de venta (reversa)",
  devolucion_venta: "Devolución", remision: "Remisión", transferencia: "Transferencia",
};

type Pestana = "compras" | "ventas" | "transferencias" | "movimientos" | "precios";

const th = "px-3 py-2 text-left font-semibold";
const thR = "px-3 py-2 text-right font-semibold";
const td = "px-3 py-2";
const tdR = "px-3 py-2 text-right tabular-nums";

export default function HistorialProducto({ productoId }: { productoId: string }) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("compras");

  useEffect(() => {
    let vivo = true;
    fetchWithSupabaseSession(`/api/productos/${productoId}/historial`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !j?.success) { setError(j?.error ?? `No se pudo cargar el historial (${r.status}).`); return; }
        setD(j.data as Datos);
      })
      .catch(() => { if (vivo) setError("Error de red al cargar el historial."); });
    return () => { vivo = false; };
  }, [productoId]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!d) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400 animate-pulse">Armando el historial del producto…</div>;

  const pestanas: { id: Pestana; label: string; n: number }[] = [
    { id: "compras", label: "Compras", n: d.compras.length },
    { id: "ventas", label: "Ventas", n: d.ventas.length },
    { id: "transferencias", label: "Transferencias y remisiones", n: d.transferencias.length + d.remisiones.length },
    { id: "movimientos", label: "Movimientos de stock", n: d.movimientos.length },
    { id: "precios", label: "Cambios de precio", n: d.cambios_precio.length },
  ];

  return (
    <div className="space-y-6">
      {/* Precio para cada tipo de cliente */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Precio para cada tipo de cliente</h2>
        <p className="mb-3 text-xs text-slate-400">
          Lo que paga cada rubro de cliente hoy.
          {d.precio_usd != null && d.precio_usd > 0 && <> Lista en dólares: {usd(d.precio_usd)}{d.cotizacion_usd ? ` (cambio ${gs(d.cotizacion_usd)})` : ""}.</>}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {d.precios_cliente.map((p) => (
            <div key={p.tipo} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">{p.tipo}</p>
              <p className="text-base font-bold tabular-nums text-slate-800">{gs(p.precio)}</p>
              <p className="text-[11px] text-slate-400">
                {p.fuente === "precio_especial" ? "Precio especial del rubro"
                  : p.ajuste_pct ? `${p.ajuste_pct > 0 ? "+" : ""}${p.ajuste_pct.toLocaleString("es-PY")}% sobre lista`
                  : "Precio de lista"}
                {d.cotizacion_usd && p.precio > 0 ? ` · ${usd(p.precio / d.cotizacion_usd)}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Lo último, de un vistazo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Se le compró por última vez a</p>
          <p className="text-sm font-semibold text-slate-800">{d.ultimo_proveedor ?? "—"}</p>
          {d.ultima_compra && (
            <p className="text-[11px] text-slate-400">
              {fecha(d.ultima_compra.fecha)} · {cant(d.ultima_compra.cantidad)} u.
              {d.ver_costos && d.ultima_compra.costo_gs != null ? ` · ${gs(d.ultima_compra.costo_gs)} c/u` : ""}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">Se le vendió por última vez a</p>
          <p className="text-sm font-semibold text-slate-800">{d.ultimo_cliente ?? "—"}</p>
          {d.ventas[0] && <p className="text-[11px] text-slate-400">{fecha(d.ventas.find((v) => !v.anulada)?.fecha ?? null)}</p>}
        </div>
        {d.ver_costos && d.ultima_compra && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">Último precio de compra</p>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{gs(d.ultima_compra.costo_gs)}</p>
            <p className="text-[11px] text-slate-400">{usd(d.ultima_compra.costo_usd ?? null)}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-3">
          {pestanas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`rounded-t-lg px-3 py-2 text-sm font-medium ${pestana === p.id ? "border border-b-white border-slate-200 bg-white text-slate-900 -mb-px" : "text-slate-500 hover:text-slate-800"}`}
            >
              {p.label} <span className="text-xs text-slate-400">({p.n})</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto p-3">
          {pestana === "compras" && (
            d.compras.length === 0 ? <Vacio /> : (
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className={th}>Fecha</th><th className={th}>N° compra</th><th className={th}>Factura</th><th className={th}>Proveedor</th>
                    <th className={thR}>Cantidad</th>
                    {d.ver_costos && <><th className={thR}>Precio tipeado</th><th className={thR}>Costo Gs.</th><th className={thR}>Costo US$</th><th className={thR}>Precio de venta</th></>}
                    <th className={th}>Quién</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.compras.map((c, i) => (
                    <tr key={i} className={c.estado === "anulada" ? "text-slate-400" : ""}>
                      <td className={td}>{fecha(c.fecha)}</td>
                      <td className={`${td} font-mono text-xs`}>
                        {c.numero_compra ?? "—"}
                        {c.estado === "anulada" && <span className="block text-[10px] font-semibold text-rose-600">ANULADA{c.anulacion_motivo ? `: ${c.anulacion_motivo}` : ""}</span>}
                      </td>
                      <td className={td}>{c.numero_factura ?? "—"}</td>
                      <td className={td}>{c.proveedor ?? "—"}</td>
                      <td className={tdR}>{cant(c.cantidad)}</td>
                      {d.ver_costos && (
                        <>
                          <td className={tdR}>
                            {c.costo_tipeado == null ? "—" : c.moneda === "USD" ? usd(c.costo_tipeado) : gs(c.costo_tipeado)}
                            {c.moneda === "USD" && c.tipo_cambio ? <span className="block text-[10px] text-slate-400">cambio {gs(c.tipo_cambio)}</span> : null}
                          </td>
                          <td className={tdR}>{gs(c.costo_gs)}</td>
                          <td className={tdR}>{usd(c.costo_usd ?? null)}</td>
                          <td className={tdR}>
                            {gs(c.precio_venta ?? null)}
                            {c.precio_venta_usd ? <span className="block text-[10px] text-slate-400">{usd(c.precio_venta_usd)}</span> : null}
                          </td>
                        </>
                      )}
                      <td className={td}>{c.usuario ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {pestana === "ventas" && (
            d.ventas.length === 0 ? <Vacio /> : (
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className={th}>Fecha</th><th className={th}>N° venta</th><th className={th}>Cliente</th><th className={th}>Condición</th>
                    <th className={thR}>Cantidad</th><th className={thR}>Precio</th><th className={thR}>Total</th><th className={th}>Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.ventas.map((v, i) => (
                    <tr key={i} className={v.anulada ? "text-slate-400 line-through" : ""}>
                      <td className={td}>{fecha(v.fecha)}</td>
                      <td className={`${td} font-mono text-xs`}>{v.numero_venta ?? "—"}</td>
                      <td className={td}>{v.cliente}</td>
                      <td className={td}>{v.condicion}</td>
                      <td className={tdR}>{cant(v.cantidad)}</td>
                      <td className={tdR}>
                        {gs(v.precio)}
                        {v.precio_lista > v.precio && <span className="block text-[10px] text-slate-400 line-through">{gs(v.precio_lista)}</span>}
                      </td>
                      <td className={tdR}>{gs(v.total)}</td>
                      <td className={td}>{v.vendedor ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {pestana === "transferencias" && (
            d.transferencias.length + d.remisiones.length === 0 ? <Vacio /> : (
              <div className="space-y-4">
                {d.transferencias.length > 0 && (
                  <table className="w-full min-w-[56rem] text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className={th}>Fecha</th><th className={th}>N°</th><th className={th}>De</th><th className={th}>A</th>
                        <th className={thR}>Cantidad</th><th className={th}>Estado</th><th className={th}>Pidió</th><th className={th}>Despachó</th><th className={th}>Recibió</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {d.transferencias.map((t, i) => (
                        <tr key={i}>
                          <td className={td}>{fecha(t.fecha)}</td>
                          <td className={`${td} font-mono text-xs`}>{t.numero ?? "—"}</td>
                          <td className={td}>{t.de}</td>
                          <td className={td}>{t.a}</td>
                          <td className={tdR}>{cant(t.cantidad)}</td>
                          <td className={`${td} capitalize`}>{t.estado ?? "—"}</td>
                          <td className={td}>{t.pidio ?? "—"}</td>
                          <td className={td}>{t.despacho ?? "—"}</td>
                          <td className={td}>{t.recibio ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {d.remisiones.length > 0 && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notas de remisión entre depósitos</p>
                    <table className="w-full min-w-[48rem] text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className={th}>Fecha</th><th className={th}>N°</th><th className={th}>De</th><th className={th}>A</th>
                          <th className={thR}>Cantidad</th><th className={th}>Estado</th><th className={th}>Quién</th><th className={th}>Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.remisiones.map((r, i) => (
                          <tr key={i}>
                            <td className={td}>{fecha(r.fecha)}</td>
                            <td className={`${td} font-mono text-xs`}>{r.numero ?? "—"}</td>
                            <td className={td}>{r.de}</td>
                            <td className={td}>{r.a}</td>
                            <td className={tdR}>{cant(r.cantidad)}</td>
                            <td className={`${td} capitalize`}>{r.estado ?? "—"}</td>
                            <td className={td}>{r.quien ?? "—"}</td>
                            <td className={td}>{r.motivo ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )
          )}

          {pestana === "movimientos" && (
            d.movimientos.length === 0 ? <Vacio /> : (
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className={th}>Fecha</th><th className={th}>Qué fue</th><th className={thR}>Entra / sale</th>
                    {d.ver_costos && <th className={thR}>Costo unit.</th>}
                    <th className={th}>Referencia</th><th className={th}>Quién</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.movimientos.map((m, i) => {
                    const sale = m.tipo === "SALIDA";
                    const anul = (m.origen ?? "").startsWith("anulacion");
                    return (
                      <tr key={i} className={anul ? "bg-rose-50/40" : ""}>
                        <td className={td}>{fecha(m.fecha)}</td>
                        <td className={td}>{ORIGEN[m.origen ?? ""] ?? m.origen ?? m.tipo ?? "—"}</td>
                        <td className={`${tdR} font-semibold ${sale ? "text-rose-600" : m.tipo === "AJUSTE" ? "text-amber-700" : "text-emerald-700"}`}>
                          {sale ? "−" : m.tipo === "AJUSTE" ? "±" : "+"}{cant(Math.abs(m.cantidad))}
                        </td>
                        {d.ver_costos && <td className={tdR}>{gs(m.costo_unitario ?? null)}</td>}
                        <td className={`${td} text-xs text-slate-500`}>{m.referencia ?? "—"}</td>
                        <td className={td}>{m.usuario ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {pestana === "precios" && (
            d.cambios_precio.length === 0 ? <Vacio /> : (
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className={th}>Fecha</th><th className={thR}>Antes</th><th className={thR}>Después</th><th className={th}>Cómo</th><th className={th}>Quién</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.cambios_precio.map((c, i) => (
                    <tr key={i}>
                      <td className={td}>{fecha(c.fecha)}</td>
                      <td className={tdR}>{c.anterior == null ? "—" : gs(c.anterior)}</td>
                      <td className={`${tdR} font-semibold`}>{gs(c.nuevo)}</td>
                      <td className={td}>{c.como}</td>
                      <td className={td}>{c.usuario ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Vacio() {
  return <p className="px-2 py-6 text-center text-sm text-slate-400">No hay registros de este producto.</p>;
}
