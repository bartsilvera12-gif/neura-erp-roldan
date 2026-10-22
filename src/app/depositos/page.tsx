"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageOpen, Package } from "lucide-react";
import { fetchDepositos, fetchStockDeposito, type Deposito, type StockItem } from "@/lib/multideposito/client";

function fmt(n: number) { return n.toLocaleString("es-PY"); }

export default function DepositosPage() {
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [ubicacionActiva, setUbicacionActiva] = useState<string>("");
  const [items, setItems] = useState<StockItem[]>([]);
  const [totalActual, setTotalActual] = useState(0);
  const [conStockActual, setConStockActual] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cargandoStock, setCargandoStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferir, setTransferir] = useState<StockItem | null>(null);

  /**
   * Últimos movimientos de transferencia. Sin esto, al entrar al depósito de
   * destino se veía la unidad sumada pero no de dónde había salido: había que
   * ir a Inventario → Movimientos a buscarla.
   */
  type MovTransfer = {
    id: string; tipo: string; cantidad: number; fecha: string;
    producto_nombre: string; referencia: string | null; usuario_nombre: string | null;
  };
  const [movs, setMovs] = useState<MovTransfer[]>([]);

  const cargarMovimientos = useCallback(async () => {
    try {
      const r = await fetch("/api/inventario/movimientos", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) return;
      const todos = (j.data?.movimientos ?? []) as Array<Record<string, unknown>>;
      setMovs(
        todos
          .filter((m) => String(m.origen ?? "") === "transferencia")
          .slice(0, 15)
          .map((m) => ({
            id: String(m.id),
            tipo: String(m.tipo ?? ""),
            cantidad: Number(m.cantidad) || 0,
            fecha: String(m.fecha ?? ""),
            producto_nombre: String(m.producto_nombre ?? ""),
            referencia: m.referencia == null ? null : String(m.referencia),
            usuario_nombre: m.usuario_nombre == null ? null : String(m.usuario_nombre),
          }))
      );
    } catch { /* el historial es informativo: si falla, la pantalla sigue */ }
  }, []);

  useEffect(() => { void cargarMovimientos(); }, [cargarMovimientos]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const r = await fetchDepositos();
      if (!r.ok) { setError(r.error); setCargando(false); return; }
      setDepositos(r.data.depositos);
      if (r.data.depositos.length > 0) setUbicacionActiva(r.data.depositos[0].id);
      setCargando(false);
    })();
  }, []);

  const cargarStock = useCallback(async (ubicacionId: string) => {
    if (!ubicacionId) return;
    setCargandoStock(true);
    const r = await fetchStockDeposito(ubicacionId);
    if (!r.ok) { setError(r.error); setCargandoStock(false); return; }
    setItems(r.data.items);
    setTotalActual(r.data.total_stock);
    setConStockActual(r.data.productos_con_stock);
    setCargandoStock(false);
  }, []);

  useEffect(() => {
    if (ubicacionActiva) cargarStock(ubicacionActiva);
  }, [ubicacionActiva, cargarStock]);

  const depositoActual = useMemo(() => depositos.find((d) => d.id === ubicacionActiva), [depositos, ubicacionActiva]);

  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-emerald-50/40 to-emerald-50/60 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-100/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-800">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" /> Inventario · Multi-depósito
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
              <span className="rounded-lg bg-white p-1.5 ring-1 ring-emerald-300/40 shadow-sm">
                <PackageOpen className="h-5 w-5 text-emerald-700" />
              </span>
              Depósitos
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Stock por ubicación. Para mover mercadería entre depósitos, usá
              <strong> Transferir</strong> en la fila del producto.
            </p>
          </div>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando depósitos…</p>
      ) : depositos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No hay depósitos configurados en la empresa.
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mr-2">Depósito:</span>
              {depositos.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setUbicacionActiva(u.id)}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${ubicacionActiva === u.id ? "bg-emerald-600 text-white shadow" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {u.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{depositoActual?.nombre}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-emerald-700">{fmt(totalActual)}</p>
              <p className="mt-1 text-[11px] text-slate-500">unidades en stock</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Productos con stock</p>
              <p className="mt-2 text-3xl font-bold tabular-nums leading-none text-slate-800">{conStockActual} <span className="text-base font-normal text-slate-500">/ {items.length}</span></p>
              <p className="mt-1 text-[11px] text-slate-500">de {items.length} productos definidos</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Stock en {depositoActual?.nombre}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">SKU</th>
                    <th className="px-5 py-3">Producto</th>
                    <th className="px-5 py-3 text-right">Stock</th>
                    <th className="px-5 py-3">Unidad</th>
                    <th className="px-5 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {cargandoStock ? (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400 italic">Sin productos configurados.</td></tr>
                  ) : items.map((p) => (
                    <tr key={p.producto_id} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.sku || "—"}</td>
                      <td className="px-5 py-3 font-semibold text-slate-800 flex items-center gap-2">
                        <Package className="h-4 w-4 text-slate-400" />{p.nombre}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums font-medium ${p.stock > 0 ? "text-slate-800" : "text-slate-400"}`}>
                        {fmt(p.stock)}
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-xs">{p.unidad || "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          disabled={p.stock <= 0 || depositos.length < 2}
                          onClick={() => setTransferir(p)}
                          title={depositos.length < 2 ? "Hace falta más de un depósito" : p.stock <= 0 ? "Sin stock para transferir" : ""}
                          className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                        >
                          Transferir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 italic">
              La mercadería ingresa al depósito que se elige al cargar el movimiento. Una transferencia no cambia el stock total del producto: lo mueve de un depósito a otro.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h3 className="border-b border-slate-100 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
              Últimas transferencias
            </h3>
            {movs.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm italic text-slate-400">
                Todavía no se transfirió mercadería entre depósitos.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {movs.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{m.producto_nombre}</p>
                      {/* La referencia ya dice "Transferencia desde X" o "a X". */}
                      <p className="truncate text-[11px] text-slate-500">{m.referencia ?? "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`text-sm font-semibold tabular-nums ${m.tipo === "ENTRADA" ? "text-emerald-700" : "text-slate-600"}`}>
                        {m.tipo === "ENTRADA" ? "+" : "−"}{fmt(m.cantidad)}
                      </span>
                      <p className="text-[10px] text-slate-400">
                        {m.fecha.slice(8, 10)}/{m.fecha.slice(5, 7)} · {m.usuario_nombre ?? "—"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {transferir && ubicacionActiva && (
        <ModalTransferencia
          item={transferir}
          origenId={ubicacionActiva}
          depositos={depositos}
          onClose={() => setTransferir(null)}
          onHecho={() => { setTransferir(null); void cargarStock(ubicacionActiva); void cargarMovimientos(); }}
        />
      )}
    </div>
  );
}

/**
 * Mueve stock de un depósito a otro. El stock total del producto no cambia:
 * sale de un lado y entra en el otro, y el kardex queda con los dos
 * movimientos para poder reconstruir a dónde fue la mercadería.
 */
function ModalTransferencia({
  item, origenId, depositos, onClose, onHecho,
}: {
  item: StockItem;
  origenId: string;
  depositos: Deposito[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const otros = depositos.filter((d) => d.id !== origenId);
  const [destinoId, setDestinoId] = useState(otros[0]?.id ?? "");
  const [cantidad, setCantidad] = useState(String(item.stock));
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nombreOrigen = depositos.find((d) => d.id === origenId)?.nombre ?? "—";
  const cant = Number(cantidad);

  async function enviar() {
    if (!destinoId) { setErr("Elegí el depósito de destino."); return; }
    if (!Number.isFinite(cant) || cant <= 0) { setErr("La cantidad debe ser mayor a cero."); return; }
    if (cant > item.stock) { setErr(`Solo hay ${fmt(item.stock)} en ${nombreOrigen}.`); return; }
    setGuardando(true);
    setErr(null);
    try {
      const r = await fetch("/api/inventario/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          producto_id: item.producto_id,
          origen_id: origenId,
          destino_id: destinoId,
          cantidad: cant,
          motivo: motivo.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setErr(j?.error ?? "No se pudo transferir."); return; }
      onHecho();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Transferir stock</h3>
            <p className="text-xs text-slate-500">{item.nombre}</p>
          </div>
          <button onClick={onClose} className="text-lg leading-none text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase text-slate-500">Desde</label>
            <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {nombreOrigen} <span className="text-slate-400">· {fmt(item.stock)} disponibles</span>
            </p>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase text-slate-500">Hacia</label>
            <select
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {otros.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase text-slate-500">Cantidad</label>
            <input
              type="number" min={1} max={item.stock} value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase text-slate-500">Motivo (opcional)</label>
            <input
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: reposición de mostrador"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={() => void enviar()}
            disabled={guardando}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {guardando ? "Transfiriendo…" : "Transferir"}
          </button>
        </div>
      </div>
    </div>
  );
}
