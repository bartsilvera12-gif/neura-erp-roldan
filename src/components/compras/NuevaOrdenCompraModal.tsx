"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import { Plus, Trash2, Search, History } from "lucide-react";
import Selector from "@/components/ui/Selector";
import HistorialPreciosModal from "@/components/compras/HistorialPreciosModal";
import {
  descuentoValido, totalLinea, totalOrden, totalDescuento,
  propuestaDesdeUltimaCompra, type UltimaCompraProducto,
} from "@/lib/compras/orden-linea";

/**
 * Armar una orden de compra.
 *
 * Se usa desde dos lados: vacía, en Órdenes de compra, y precargada con lo que
 * falta, desde Inventario → Bajo mínimo. Es el mismo formulario porque es la
 * misma decisión —a quién le pido qué— y mantener dos sería garantizar que un
 * día se comporten distinto.
 *
 * ── EL PROVEEDOR SE ELIGE A MANO, Y NO ES UN DESCUIDO ──────────────────────
 *   Ningún artículo tiene `proveedor_principal_id` cargado (0 de 1.002), así
 *   que el sistema no tiene con qué adivinar a quién pedirle cada cosa. Se
 *   podría inferir del historial de compras, pero sería una suposición
 *   presentada como un dato. Mientras no se cargue el proveedor principal, lo
 *   elige la persona.
 */

export type ItemOrden = {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  /** Descuento de la línea en % (pedido del cliente). */
  descuento_pct?: number;
  /** Si se eligió del catálogo: con esto «Cargar factura» arma la compra. */
  producto_id?: string | null;
  sku?: string | null;
};

const vacio = (): ItemOrden => ({ descripcion: "", cantidad: 1, unidad: "UNIDAD", precio_unitario: 0, descuento_pct: 0 });

/** Un artículo del catálogo, como lo devuelve /api/productos/search. */
type HitProducto = {
  id: string; nombre: string; sku: string;
  stock_actual: number; unidad_medida: string; costo_promedio: number;
};

/**
 * Lo que se sabe de un artículo elegido: el stock que hay y cómo fue su
 * última compra. Se guarda por línea, aparte de los datos que se mandan.
 */
type DatosArticulo = {
  stock: number;
  ultima: UltimaCompraProducto | null;
  /** Mientras se busca la última compra. */
  cargando: boolean;
};

const fmtFechaCorta = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export default function NuevaOrdenCompraModal({
  itemsIniciales, origen, onClose, onCreada,
}: {
  /** Precarga, p. ej. lo que falta según Bajo mínimo. */
  itemsIniciales?: ItemOrden[];
  /** De dónde vino la precarga, para dejarlo escrito en la orden. */
  origen?: string;
  onClose: () => void;
  onCreada: (numeroControl: string) => void;
}) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [moneda, setMoneda] = useState<"PYG" | "USD">("PYG");
  const [fecha, setFecha] = useState(() => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState(origen ? `Armada desde ${origen}.` : "");
  const [items, setItems] = useState<ItemOrden[]>(
    itemsIniciales && itemsIniciales.length > 0 ? itemsIniciales : [vacio()]
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Stock y última compra de cada línea que eligió un artículo del catálogo. */
  const [datos, setDatos] = useState<Record<number, DatosArticulo>>({});
  /** En qué línea se está buscando, y qué devolvió la búsqueda. */
  const [buscando, setBuscando] = useState<{ i: number; texto: string; hits: HitProducto[] } | null>(null);
  /** El artículo cuyo historial de precios se está mirando. */
  const [historial, setHistorial] = useState<{ id: string; nombre: string } | null>(null);

  useEffect(() => { void getProveedores().then(setProveedores); }, []);

  const opciones = useMemo(
    () => proveedores.map((p) => ({ id: p.id, label: p.nombre })),
    [proveedores]
  );
  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;

  const total = totalOrden(items);
  const descontado = totalDescuento(items);
  const conDescripcion = items.filter((i) => i.descripcion.trim() !== "");

  function cambiar(i: number, campo: keyof ItemOrden, valor: string) {
    setItems((prev) => prev.map((it, k) => {
      if (k !== i) return it;
      if (campo === "cantidad" || campo === "precio_unitario" || campo === "descuento_pct") {
        const n = Number(valor.replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
        return { ...it, [campo]: campo === "descuento_pct" ? descuentoValido(n) : n };
      }
      return { ...it, [campo]: valor };
    }));
    // Lo que se escribe a mano deja de ser el artículo del catálogo.
    if (campo === "descripcion") {
      setItems((prev) => prev.map((it, k) => (k === i ? { ...it, producto_id: null, sku: null } : it)));
      setDatos((d) => { const c = { ...d }; delete c[i]; return c; });
    }
  }

  /**
   * Saca una línea. `datos` va por índice, así que hay que correrlo: si no, el
   * stock y la última compra de una línea pasarían a mostrarse en otra.
   */
  function quitarLinea(i: number) {
    setItems((p) => p.filter((_, k) => k !== i));
    setDatos((d) => {
      const out: Record<number, DatosArticulo> = {};
      for (const [k, v] of Object.entries(d)) {
        const n = Number(k);
        if (n === i) continue;
        out[n > i ? n - 1 : n] = v;
      }
      return out;
    });
    setBuscando(null);
  }

  /** Busca el texto de la línea en el inventario y abre la lista para elegir. */
  async function buscarArticulo(i: number, texto: string) {
    const q = texto.trim();
    if (q.length < 2) {
      setError("Escribí al menos dos letras del artículo para buscarlo.");
      return;
    }
    setError(null);
    setBuscando({ i, texto: q, hits: [] });
    try {
      const r = await apiFetch(`/api/productos/search?q=${encodeURIComponent(q)}&limit=20`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setBuscando(null);
        setError(j?.error ?? `No se pudo buscar el artículo (${r.status}).`);
        return;
      }
      // /api/productos/search devuelve { items, count, q }.
      const hits = (j.data?.items ?? []) as HitProducto[];
      setBuscando({ i, texto: q, hits: Array.isArray(hits) ? hits : [] });
    } catch {
      setBuscando(null);
      setError("No se pudo buscar el artículo. Probá de nuevo.");
    }
  }

  /**
   * ── TRAER TODO DE LA ÚLTIMA COMPRA (pedido del cliente) ────────────────
   * Al elegir un artículo del catálogo se busca su última compra y se propone
   * el mismo precio en la misma moneda («si fue 20 dólares, que salga 20
   * dólares»), y se muestra el stock que hay.
   *
   * La moneda de la orden se cambia sola solo si TODAVÍA NO SE CARGÓ NINGÚN
   * precio a mano: cambiarla con líneas ya cargadas convertiría los números de
   * las otras líneas en otra cosa sin avisar.
   */
  async function elegirArticulo(i: number, p: HitProducto) {
    setItems((prev) => prev.map((it, k) => (
      k === i
        ? { ...it, descripcion: p.nombre, unidad: p.unidad_medida || it.unidad, producto_id: p.id, sku: p.sku || null }
        : it
    )));
    setBuscando(null);
    setDatos((d) => ({ ...d, [i]: { stock: Number(p.stock_actual) || 0, ultima: null, cargando: true } }));
    try {
      const r = await apiFetch(`/api/compras?ultima_de_producto=${encodeURIComponent(p.id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      const u = (j?.data?.ultima ?? null) as UltimaCompraProducto | null;
      setDatos((d) => ({ ...d, [i]: { stock: Number(p.stock_actual) || 0, ultima: u, cargando: false } }));
      const prop = propuestaDesdeUltimaCompra(u);
      if (prop) {
        setItems((prev) => {
          const sinPrecios = prev.every((it, k) => k === i || !(Number(it.precio_unitario) > 0));
          if (sinPrecios && prop.moneda !== moneda) setMoneda(prop.moneda);
          return prev.map((it, k) => (k === i ? { ...it, precio_unitario: prop.precio } : it));
        });
      }
    } catch {
      // Sin la última compra el artículo igual queda elegido, con precio a mano.
      setDatos((d) => ({ ...d, [i]: { stock: Number(p.stock_actual) || 0, ultima: null, cargando: false } }));
    }
  }

  async function guardar() {
    if (!proveedor) { setError("Elegí el proveedor."); return; }
    if (conDescripcion.length === 0) { setError("Agregá al menos un artículo."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedor.id,
          proveedor_nombre: proveedor.nombre,
          fecha, moneda,
          observaciones: observaciones.trim() || null,
          items: conDescripcion,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onCreada(String(j.data?.orden?.numero_control ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la orden.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Nueva orden de compra</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Es el pedido al proveedor. No mueve stock ni genera deuda: eso pasa cuando se carga la compra.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="sm:col-span-2">
            <span className="text-[11px] font-medium text-slate-500">Proveedor</span>
            <SearchableSelect
              value={proveedorId}
              onChange={(v) => { setProveedorId(v); setError(null); }}
              options={opciones}
              placeholder="Buscá el proveedor…"
              className="mt-1"
            />
            {proveedor && (proveedor.contacto || proveedor.email) && (
              <span className="mt-1 block text-[11px] text-slate-500">
                {proveedor.contacto ? `Vendedor: ${proveedor.contacto}` : ""}
                {proveedor.contacto && proveedor.email ? " · " : ""}
                {proveedor.email ?? ""}
              </span>
            )}
          </label>

          <label>
            <span className="text-[11px] font-medium text-slate-500">Fecha</span>
            <input
              type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="text-[11px] font-medium text-slate-500">Moneda</span>
            <Selector
              value={moneda} onChange={(e) => setMoneda(e.target.value === "USD" ? "USD" : "PYG")}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="PYG">Guaraníes</option>
              <option value="USD">Dólares</option>
            </Selector>
          </label>
          <span className="ml-auto text-sm text-slate-500">
            {descontado > 0 && (
              <span className="mr-3 text-[11px] text-violet-600">
                Descuentos: −{moneda === "USD" ? "US$ " : "Gs. "}
                {descontado.toLocaleString("es-PY", { maximumFractionDigits: 2 })}
              </span>
            )}
            Total: <strong className="tabular-nums text-slate-800">
              {moneda === "USD" ? "US$ " : "Gs. "}
              {total.toLocaleString("es-PY", { maximumFractionDigits: 2 })}
            </strong>
          </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Artículo</th>
                <th className="w-20 px-2 py-1.5 text-right font-semibold">Stock</th>
                <th className="w-24 px-2 py-1.5 text-right font-semibold">Cantidad</th>
                <th className="w-24 px-2 py-1.5 text-left font-semibold">Unidad</th>
                <th className="w-28 px-2 py-1.5 text-right font-semibold">Precio</th>
                <th className="w-20 px-2 py-1.5 text-right font-semibold">Desc. %</th>
                <th className="w-28 px-2 py-1.5 text-right font-semibold">Subtotal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="relative px-2 py-1">
                    <div className="flex items-center gap-1">
                      <input
                        value={it.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                        placeholder="Qué se pide"
                        className="w-full rounded border border-transparent px-1.5 py-1 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                      />
                      {/* Elegir del catálogo trae stock, precio y moneda de la
                          última compra. Escribir a mano sigue valiendo: hay
                          cosas que se piden y no están en el inventario. */}
                      <button
                        type="button"
                        onClick={() => void buscarArticulo(i, it.descripcion)}
                        title="Buscar el artículo en el inventario"
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#3F8E91]"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                      {/* A cuánto se compró antes: se ve sin salir del
                          formulario, que es cuando hace falta decidir. */}
                      {it.producto_id && (
                        <button
                          type="button"
                          onClick={() => setHistorial({ id: String(it.producto_id), nombre: it.descripcion })}
                          title="Ver el historial de precios de este artículo"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#3F8E91]"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {buscando?.i === i && (
                      <div className="absolute left-2 right-2 top-full z-20 mt-0.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                        {buscando.hits.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-slate-500">
                            No se encontró «{buscando.texto}» en el inventario. Se puede dejar escrito a mano.
                          </p>
                        ) : (
                          buscando.hits.map((h) => (
                            <button
                              key={h.id} type="button" onClick={() => void elegirArticulo(i, h)}
                              className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                            >
                              <span className="block font-medium text-slate-800">{h.nombre}</span>
                              <span className="block text-[10px] text-slate-500">
                                {h.sku ? `${h.sku} · ` : ""}stock {Number(h.stock_actual) || 0} {h.unidad_medida}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {/* De dónde salió el precio que se propuso. */}
                    {datos[i] && (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {datos[i].cargando
                          ? "Buscando la última compra…"
                          : datos[i].ultima
                            ? `Última compra: ${datos[i].ultima?.moneda === "USD" ? "US$ " : "Gs. "}${(Number(datos[i].ultima?.costo_unitario_original) || Number(datos[i].ultima?.costo_unitario) || 0).toLocaleString("es-PY")} · ${fmtFechaCorta(datos[i].ultima?.fecha)}${datos[i].ultima?.proveedor_nombre ? ` · ${datos[i].ultima?.proveedor_nombre}` : ""}`
                            : "Nunca se compró este artículo: el precio va a mano."}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                    {datos[i] ? (Number(datos[i].stock) || 0).toLocaleString("es-PY") : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.unidad} onChange={(e) => cambiar(i, "unidad", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.precio_unitario} onChange={(e) => cambiar(i, "precio_unitario", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={it.descuento_pct ?? 0} onChange={(e) => cambiar(i, "descuento_pct", e.target.value)}
                      className="w-full rounded border border-transparent px-1.5 py-1 text-right tabular-nums hover:border-slate-200 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium text-slate-700">
                    {totalLinea(it).toLocaleString("es-PY", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-1 py-1 text-center">
                    {items.length > 1 && (
                      <button
                        type="button" onClick={() => quitarLinea(i)}
                        className="text-slate-300 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button" onClick={() => setItems((p) => [...p, vacio()])}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#3F8E91] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar artículo
        </button>

        <label className="mt-3 block">
          <span className="text-[11px] font-medium text-slate-500">
            Observaciones <span className="font-normal normal-case text-slate-400">(salen en la hoja)</span>
          </span>
          <textarea
            value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Ej: entregar en depósito central, horario de mañana"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void guardar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Creando…" : `Crear la orden (${conDescripcion.length})`}
          </button>
        </div>
      </div>

      {/* Va fuera del cuadro para que el clic adentro no cierre la orden. */}
      {historial && (
        <HistorialPreciosModal
          productoIdInicial={historial.id}
          productoNombreInicial={historial.nombre}
          onClose={() => setHistorial(null)}
        />
      )}
    </div>
  );
}
