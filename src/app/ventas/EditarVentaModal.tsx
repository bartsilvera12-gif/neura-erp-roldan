"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Venta, TipoIvaVenta } from "@/lib/ventas/types";

/**
 * Edición de una venta emitida (punto 2.2).
 *
 * Se puede cambiar todo: productos, cantidades, precios, IVA, tipo de venta y
 * método de pago. Es lo que pidió el cliente.
 *
 * El número de comprobante NO se toca y no se ofrece cambiarlo: editar no es
 * emitir otro comprobante.
 *
 * El motivo es obligatorio. Sin él, el historial diría que algo cambió pero no
 * por qué, que es justo lo que se va a preguntar seis meses después.
 */

type Linea = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  precio_venta_original: number;
  tipo_iva: TipoIvaVenta;
};

type ProductoLite = {
  id: string;
  nombre: string;
  sku: string | null;
  precio_venta: number;
  stock_actual: number;
};

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

/** Totales de una línea con IVA incluido en el precio. */
function totalesDe(l: Linea) {
  const total = Math.round(l.cantidad * l.precio_venta);
  const divisor = l.tipo_iva === "10%" ? 1.1 : l.tipo_iva === "5%" ? 1.05 : 1;
  const subtotal = Math.round(total / divisor);
  return { total, subtotal, iva: total - subtotal };
}

export default function EditarVentaModal({
  venta,
  onClose,
  onGuardado,
}: {
  venta: Venta;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<Linea[]>(() =>
    venta.items.map((i) => ({
      producto_id: i.producto_id,
      producto_nombre: i.producto_nombre,
      sku: i.sku ?? null,
      cantidad: i.cantidad,
      precio_venta: i.precio_venta,
      precio_venta_original: i.precio_venta_original || i.precio_venta,
      tipo_iva: i.tipo_iva,
    }))
  );
  const [tipoVenta, setTipoVenta] = useState(venta.tipo_venta);
  const [metodoPago, setMetodoPago] = useState(venta.metodo_pago ?? "efectivo");
  const [plazoDias, setPlazoDias] = useState(String(venta.plazo_dias ?? ""));
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catálogo para agregar productos.
  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    fetch("/api/productos?limit=500", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        setProductos(
          ((j.data?.productos ?? []) as Array<Record<string, unknown>>).map((p) => ({
            id: String(p.id),
            nombre: String(p.nombre ?? ""),
            sku: p.sku == null ? null : String(p.sku),
            precio_venta: Number(p.precio_venta) || 0,
            stock_actual: Number(p.stock_actual) || 0,
          }))
        );
      })
      .catch(() => { /* sin catálogo solo se pueden editar las líneas que ya están */ });
  }, []);

  const candidatos = useMemo(() => {
    if (buscar.trim().length < 2) return [];
    const yaEstan = new Set(lineas.map((l) => l.producto_id));
    return productos
      .filter((p) => !yaEstan.has(p.id) && productoMatchesQuery(buscar, p.nombre, p.sku))
      .slice(0, 8);
  }, [buscar, productos, lineas]);

  const totales = useMemo(() => {
    let total = 0, subtotal = 0, iva = 0;
    for (const l of lineas) {
      const t = totalesDe(l);
      total += t.total; subtotal += t.subtotal; iva += t.iva;
    }
    return { total, subtotal, iva };
  }, [lineas]);

  const diferencia = totales.total - venta.total;

  function cambiar(idx: number, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function guardar() {
    if (!motivo.trim()) { setError("Escribí el motivo del cambio."); return; }
    if (lineas.length === 0) { setError("La venta tiene que quedar con al menos un producto."); return; }
    // Las cantidades se dejan en 0 mientras se escriben; en cero no se guarda.
    const enCero = lineas.find((l) => l.cantidad < 1);
    if (enCero) { setError(`Poné una cantidad en ${enCero.producto_nombre}.`); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/ventas/${venta.id}/editar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivo: motivo.trim(),
          items: lineas,
          tipo_venta: tipoVenta,
          metodo_pago: metodoPago,
          plazo_dias: tipoVenta === "CREDITO" ? plazoDias : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo editar la venta.");
      onGuardado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              Editar venta {venta.numero_control}
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              El número de comprobante no cambia. Queda registrado quién editó, cuándo y qué cambió.
            </p>
          </div>
          <button
            type="button" onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {venta.factura_id && (
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-[12px] leading-snug text-amber-800">
            <b>Esta venta ya tiene factura emitida{venta.numero_factura ? ` (${venta.numero_factura})` : ""}.</b>{" "}
            Editarla cambia el registro interno, pero la factura que se le entregó al cliente queda
            como está. Si el cliente tiene que recibir otro importe, corresponde una nota de crédito.
            La edición se va a guardar marcada como hecha sobre una venta facturada.
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Líneas */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 w-20 text-right">Cant.</th>
                  <th className="px-3 py-2 w-28 text-right">Precio</th>
                  <th className="px-3 py-2 w-24">IVA</th>
                  <th className="px-3 py-2 w-28 text-right">Total</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineas.map((l, idx) => {
                  const t = totalesDe(l);
                  return (
                    <tr key={`${l.producto_id}-${idx}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{l.producto_nombre}</p>
                        {l.sku && <p className="font-mono text-[11px] text-slate-400">{l.sku}</p>}
                      </td>
                      <td className="px-3 py-2">
                        {/* Mientras se escribe se deja vacío o en 0.
                            Antes cada tecla lo forzaba a 1, así que para poner
                            10 había que borrar el 1 y el 1 volvía solo: no
                            había forma de cambiar la cantidad. Se corrige al
                            salir del campo, y Guardar no acepta líneas en 0. */}
                        <input
                          type="number" min={0} value={l.cantidad === 0 ? "" : l.cantidad}
                          onChange={(e) => {
                            const v = e.target.value;
                            cambiar(idx, { cantidad: v === "" ? 0 : Math.max(0, Number(v) || 0) });
                          }}
                          onBlur={() => { if (l.cantidad < 1) cambiar(idx, { cantidad: 1 }); }}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={0} value={l.precio_venta === 0 ? "" : l.precio_venta}
                          onChange={(e) => {
                            const v = e.target.value;
                            cambiar(idx, { precio_venta: v === "" ? 0 : Math.max(0, Number(v) || 0) });
                          }}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.tipo_iva}
                          onChange={(e) => cambiar(idx, { tipo_iva: e.target.value as TipoIvaVenta })}
                          className="w-full rounded border border-slate-200 px-1 py-1 text-sm"
                        >
                          <option value="EXENTA">Exenta</option>
                          <option value="5%">5%</option>
                          <option value="10%">10%</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {gs(t.total)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setLineas((p) => p.filter((_, i) => i !== idx))}
                          className="rounded px-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Quitar de la venta"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {lineas.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No queda ningún producto. Agregá al menos uno.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Agregar producto */}
          <div>
            <input
              type="text" value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Agregar producto: escribí nombre o SKU…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {candidatos.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
                {candidatos.map((p) => (
                  <button
                    key={p.id} type="button"
                    onClick={() => {
                      setLineas((prev) => [...prev, {
                        producto_id: p.id, producto_nombre: p.nombre, sku: p.sku,
                        cantidad: 1, precio_venta: p.precio_venta,
                        precio_venta_original: p.precio_venta, tipo_iva: "10%",
                      }]);
                      setBuscar("");
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-slate-800">{p.nombre}</span>
                      {p.sku && <span className="ml-2 font-mono text-[11px] text-slate-400">{p.sku}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {gs(p.precio_venta)} · stock {p.stock_actual}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Condiciones */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Tipo</span>
              <select
                value={tipoVenta}
                onChange={(e) => setTipoVenta(e.target.value as Venta["tipo_venta"])}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Método de pago</span>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as typeof metodoPago)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
            {tipoVenta === "CREDITO" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase text-slate-500">Plazo (días)</span>
                <input
                  type="number" min={1} value={plazoDias}
                  onChange={(e) => setPlazoDias(e.target.value)}
                  className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            )}
          </div>

          {/* Totales */}
          <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <div className="flex justify-between text-[12px] text-slate-500">
              <span>Subtotal</span><span className="tabular-nums">{gs(totales.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[12px] text-slate-500">
              <span>IVA</span><span className="tabular-nums">{gs(totales.iva)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900">
              <span>Total</span><span className="tabular-nums">{gs(totales.total)}</span>
            </div>
            {diferencia !== 0 && (
              <p className={`mt-1 text-[12px] font-medium ${diferencia > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {diferencia > 0 ? "Sube" : "Baja"} {gs(Math.abs(diferencia))} respecto del original ({gs(venta.total)}).
              </p>
            )}
          </div>

          {/* Motivo */}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase text-slate-500">
              Motivo del cambio <span className="text-rose-500">*</span>
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ej.: el cliente devolvió 2 unidades en el momento"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={guardar} disabled={guardando || !motivo.trim() || lineas.length === 0}
            className="flex-1 rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0284C7] disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
