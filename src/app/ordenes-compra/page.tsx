"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import AccionesTabla from "@/components/ui/AccionesTabla";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import NuevaOrdenCompraModal from "@/components/compras/NuevaOrdenCompraModal";
import EnviarOrdenModal from "@/components/compras/EnviarOrdenModal";
import { Printer, Plus, Check, X, Mail } from "lucide-react";
import Selector from "@/components/ui/Selector";

/**
 * Órdenes de compra: el PEDIDO que se le manda al proveedor.
 *
 * ── QUÉ NO ES ──────────────────────────────────────────────────────────────
 *   No es una compra registrada. No toca inventario, ni costos, ni cuentas por
 *   pagar. Es el papel previo: "mandame esto". La compra se carga después,
 *   cuando llega la mercadería con su factura.
 *
 * ── POR QUÉ ESTA PANTALLA NO EXISTÍA ───────────────────────────────────────
 *   La API estaba completa desde hacía tiempo —crear con correlativo OC-,
 *   editar, cambiar estado, imprimir en A4— y nunca se le hizo la pantalla.
 *   La tabla estaba vacía porque no había forma de cargar una orden sin
 *   pegarle a la API a mano.
 */

type Item = { descripcion: string; cantidad: number; unidad: string; precio_unitario: number };
type Orden = {
  id: string;
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  fecha: string;
  moneda: string;
  estado: string;
  observaciones: string | null;
  items: Item[];
};

const gs = (v: number) => Math.round(v).toLocaleString("es-PY");
const fmtFecha = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "—");
};
const totalDe = (o: Orden) =>
  (o.items ?? []).reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0), 0);

const TONO: Record<string, string> = {
  pendiente: "bg-violet-100 text-violet-800",
  recibida: "bg-emerald-100 text-emerald-800",
  anulada: "bg-slate-100 text-slate-500 line-through",
};

export default function OrdenesCompraPage() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<Orden | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/ordenes-compra", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudieron cargar las órdenes.");
      setOrdenes((j.data?.ordenes ?? []) as Orden[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function cambiarEstado(o: Orden, nuevo: string) {
    if (nuevo === "anulada" && !window.confirm(`¿Anular la orden ${o.numero_control}?`)) return;
    setOcupada(o.id);
    try {
      const r = await apiFetch("/api/ordenes-compra", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, estado: nuevo }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cambiar el estado.");
      await cargar();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
    } finally {
      setOcupada(null);
    }
  }

  const filtradas = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ordenes.filter((o) => {
      if (estado && o.estado !== estado) return false;
      if (!s) return true;
      return (
        o.proveedor_nombre.toLowerCase().includes(s) ||
        o.numero_control.toLowerCase().includes(s) ||
        (o.items ?? []).some((i) => i.descripcion.toLowerCase().includes(s))
      );
    });
  }, [ordenes, q, estado]);

  const filasExport = useMemo(
    () => filtradas.map((o) => [
      o.numero_control, fmtFecha(o.fecha), o.proveedor_nombre, o.estado,
      (o.items ?? []).length, o.moneda, Math.round(totalDe(o)),
    ]),
    [filtradas]
  );

  const totalPendiente = filtradas
    .filter((o) => o.estado === "pendiente")
    .reduce((s, o) => s + totalDe(o), 0);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Compras"
        title="Órdenes de compra"
        description="El pedido que se le manda al proveedor. No es una compra: no toca stock ni cuentas por pagar"
        actions={
          <button
            type="button" onClick={() => setNueva(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" /> Nueva orden
          </button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buscar</span>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor, N° o artículo"
            className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estado</span>
          <Selector
            value={estado} onChange={(e) => setEstado(e.target.value)}
            className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="pendiente">Pendientes</option>
            <option value="recibida">Recibidas</option>
            <option value="anulada">Anuladas</option>
          </Selector>
        </label>

        {totalPendiente > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Pedido pendiente</p>
            <p className="text-sm font-bold tabular-nums text-violet-900">Gs. {gs(totalPendiente)}</p>
          </div>
        )}

        {filasExport.length > 0 && (
          <AccionesTabla
            className="ml-auto"
            titulo="Órdenes de compra"
            archivo="ordenes-compra"
            columnas={["N°", "Fecha", "Proveedor", "Estado", "Ítems", "Moneda", "Total"]}
            filas={filasExport}
            sumar={[6]}
          />
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {aviso && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <span className="flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="text-emerald-600">✕</button>
        </div>
      )}

      {cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : filtradas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">
            {ordenes.length === 0 ? "Todavía no hay órdenes de compra." : "Ninguna orden coincide con el filtro."}
          </p>
          {ordenes.length === 0 && (
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Se puede armar una desde cero con <strong>Nueva orden</strong>, o desde{" "}
              <strong>Inventario → Bajo mínimo</strong>, tildando lo que falta.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <EdgeScrollArea>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="w-6" />
                  <th className="px-3 py-2 text-left font-semibold">N°</th>
                  <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                  <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                  <th className="px-3 py-2 text-center font-semibold">Ítems</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-left font-semibold">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtradas.map((o) => {
                  const open = abierta === o.id;
                  return (
                    // La key va en el Fragment, que es el elemento de la lista:
                    // ponerla en los <tr> de adentro deja a React sin forma de
                    // identificar la fila al reordenar.
                    <Fragment key={o.id}>
                      <tr
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setAbierta(open ? null : o.id)}
                      >
                        <td className="px-2 text-center text-slate-400">{open ? "▾" : "▸"}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-700">{o.numero_control}</td>
                        <td className="px-3 py-2.5 text-slate-600">{fmtFecha(o.fecha)}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{o.proveedor_nombre}</td>
                        <td className="px-3 py-2.5 text-center text-slate-600">{(o.items ?? []).length}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                          {o.moneda === "USD" ? "US$ " : ""}{gs(totalDe(o))}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO[o.estado] ?? ""}`}>
                            {o.estado}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {o.estado !== "anulada" && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEnviando(o); }}
                              className="mr-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#3F8E91] hover:underline"
                              title="Mandarle la orden al vendedor del proveedor"
                            >
                              <Mail className="h-3.5 w-3.5" /> Mandar
                            </button>
                          )}
                          <a
                            href={`/api/ordenes-compra/imprimir?id=${o.id}`}
                            target="_blank" rel="noopener"
                            onClick={(e) => e.stopPropagation()}
                            className="mr-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline"
                          >
                            <Printer className="h-3.5 w-3.5" /> Imprimir
                          </a>
                          {o.estado === "pendiente" && (
                            <>
                              <button
                                type="button" disabled={ocupada === o.id}
                                onClick={(e) => { e.stopPropagation(); void cambiarEstado(o, "recibida"); }}
                                className="mr-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50"
                                title="Marcar que llegó la mercadería. La compra se carga aparte, con su factura"
                              >
                                <Check className="h-3.5 w-3.5" /> Recibida
                              </button>
                              <button
                                type="button" disabled={ocupada === o.id}
                                onClick={(e) => { e.stopPropagation(); void cambiarEstado(o, "anulada"); }}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 hover:underline disabled:opacity-50"
                              >
                                <X className="h-3.5 w-3.5" /> Anular
                              </button>
                            </>
                          )}
                        </td>
                      </tr>

                      {open && (
                        <tr className="bg-slate-50/60">
                          <td />
                          <td colSpan={7} className="px-3 py-3">
                            {o.observaciones && (
                              <p className="mb-2 text-[11px] italic text-slate-500">{o.observaciones}</p>
                            )}
                            <table className="w-full text-xs">
                              <thead className="text-slate-400">
                                <tr>
                                  <th className="py-1 text-left font-medium">Artículo</th>
                                  <th className="py-1 text-right font-medium">Cantidad</th>
                                  <th className="py-1 text-left font-medium">Unidad</th>
                                  <th className="py-1 text-right font-medium">Precio</th>
                                  <th className="py-1 text-right font-medium">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(o.items ?? []).map((i, k) => (
                                  <tr key={`${o.id}-${k}`} className="border-t border-slate-100">
                                    <td className="py-1.5 text-slate-700">{i.descripcion}</td>
                                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                                      {Number(i.cantidad).toLocaleString("es-PY")}
                                    </td>
                                    <td className="py-1.5 text-slate-500">{i.unidad}</td>
                                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                                      {gs(Number(i.precio_unitario) || 0)}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums font-medium text-slate-800">
                                      {gs((Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0))}
                                    </td>
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
          </EdgeScrollArea>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Una orden de compra es el <strong>pedido</strong>: no mueve stock, no genera deuda y no entra en
        el flujo de caja. Cuando llega la mercadería se carga la <strong>compra</strong> con su factura,
        que es lo que sí toca inventario y cuentas por pagar. Marcar una orden como{" "}
        <strong>recibida</strong> no crea esa compra: solo deja constancia de que el pedido se cumplió.
      </p>

      {enviando && (
        <EnviarOrdenModal
          ordenId={enviando.id}
          numeroControl={enviando.numero_control}
          onClose={() => setEnviando(null)}
          onEnviada={(m) => { setEnviando(null); setAviso(m); }}
        />
      )}

      {nueva && (
        <NuevaOrdenCompraModal
          onClose={() => setNueva(false)}
          onCreada={() => { setNueva(false); void cargar(); }}
        />
      )}
    </div>
  );
}
