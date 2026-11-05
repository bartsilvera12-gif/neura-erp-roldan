"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import Selector from "@/components/ui/Selector";

/**
 * Precios por depósito.
 *
 * ── QUÉ SE CARGA ACÁ Y QUÉ NO ─────────────────────────────────────────────
 *   Acá se cargan EXCEPCIONES: el precio que un depósito cobra cuando no es
 *   el de la lista. El precio normal sigue viviendo en el producto.
 *
 *   Se hizo así y no con una lista completa por depósito porque con listas
 *   completas cada producto nuevo habría que cargarlo tantas veces como
 *   depósitos haya, y un precio corregido en el producto no llegaría a
 *   ninguno. Con excepciones, lo normal no se carga dos veces.
 *
 * ── LO QUE SE VE AL LADO ──────────────────────────────────────────────────
 *   El precio de lista y el stock de ESE depósito. Poner un precio sin ver
 *   esas dos cosas es poner un precio a ciegas: no se sabe si se está
 *   abaratando o encareciendo, ni si en ese depósito hay algo para vender.
 */

type Deposito = { id: string; nombre: string; codigo: string | null };

type Fila = {
  producto_id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio_lista: number;
  precio_deposito: number | null;
  markup_deposito: number | null;
  diferencia_pct: number | null;
  stock_deposito: number | null;
  stock_global: number;
};

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`;

export default function PreciosDepositoPage() {
  const { isAdmin } = useIsAdmin();
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [depositoId, setDepositoId] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [soloConPrecio, setSoloConPrecio] = useState(false);

  // Edición de una fila: id del producto + lo tipeado.
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetchWithSupabaseSession("/api/inventario/ubicaciones", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) return;
        const list = ((j.data?.ubicaciones ?? []) as Deposito[]).map((d) => ({
          id: String(d.id),
          nombre: String(d.nombre ?? ""),
          codigo: d.codigo ?? null,
        }));
        setDepositos(list);
        if (list.length > 0) setDepositoId(list[0]!.id);
      })
      .catch(() => setError("No se pudieron cargar los depósitos."));
  }, []);

  const cargar = useCallback(async () => {
    if (!depositoId) return;
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ deposito: depositoId });
      if (q.trim()) qs.set("q", q.trim());
      const r = await fetchWithSupabaseSession(`/api/precios-deposito?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        setFilas([]);
        return;
      }
      setFilas((j.data.productos ?? []) as Fila[]);
      setAviso(typeof j.data.aviso === "string" ? j.data.aviso : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [depositoId, q]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(f: Fila, crudo: string) {
    setGuardando(true);
    setError(null);
    try {
      const limpio = crudo.trim();
      // Vacío = "volvé a cobrar la lista". Es la única forma de deshacer sin
      // tener que poner a mano el mismo número que el producto.
      const precio = limpio === "" ? null : Number(limpio.replace(/[^\d.-]/g, ""));
      if (precio != null && (!Number.isFinite(precio) || precio < 0)) {
        setError("Poné un número válido, o dejalo vacío para volver al precio de lista.");
        return;
      }
      const r = await fetchWithSupabaseSession("/api/precios-deposito", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposito: depositoId,
          producto_id: f.producto_id,
          precio_venta: precio,
          markup_pct: null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setEditando(null);
      setValor("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const visibles = useMemo(
    () => (soloConPrecio ? filas.filter((f) => f.precio_deposito != null) : filas),
    [filas, soloConPrecio]
  );
  const conPrecio = filas.filter((f) => f.precio_deposito != null).length;
  const depositoSel = depositos.find((d) => d.id === depositoId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventario" className="text-sm text-sky-600 hover:underline">← Inventario</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800 sm:text-3xl">Precios por depósito</h1>
        <p className="max-w-3xl text-slate-600">
          El precio normal de cada producto es el de la lista. Acá se carga la excepción: lo que
          cobra un depósito en particular. Caja usa este precio cuando se vende desde ese depósito.
        </p>
      </div>

      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{aviso}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {!isAdmin && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Podés consultar los precios. Cambiarlos lo hace un administrador.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-slate-500">
          Depósito
          <Selector
            value={depositoId}
            onChange={(e) => setDepositoId(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {depositos.length === 0 && <option value="">Sin depósitos cargados</option>}
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}{d.codigo ? ` — ${d.codigo}` : ""}</option>
            ))}
          </Selector>
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Buscar
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre o código…"
            className="mt-1 block w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="inline-flex items-center gap-2 pb-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={soloConPrecio}
            onChange={(e) => setSoloConPrecio(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Solo los que tienen precio propio ({conPrecio})
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : !depositoSel ? (
          <p className="p-6 text-sm text-slate-500">
            Todavía no hay depósitos cargados. Se crean en Inventario → Ubicaciones.
          </p>
        ) : visibles.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            {soloConPrecio
              ? `Ningún producto tiene precio propio en ${depositoSel.nombre}: todos cobran la lista.`
              : "No hay productos que coincidan."}
          </p>
        ) : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Producto</th>
                <th className="px-4 py-3 text-right font-semibold">Costo</th>
                <th className="px-4 py-3 text-right font-semibold">Precio de lista</th>
                <th className="px-4 py-3 text-right font-semibold">Precio en {depositoSel.nombre}</th>
                <th className="px-4 py-3 text-right font-semibold">Dif.</th>
                <th className="px-4 py-3 text-right font-semibold">Stock acá</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const enEdicion = editando === f.producto_id;
                const propio = f.precio_deposito != null;
                return (
                  <tr key={f.producto_id} className={`border-t border-slate-100 ${enEdicion ? "bg-amber-50/60" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{f.nombre}</div>
                      <div className="font-mono text-[11px] text-slate-400">{f.sku}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{gs(f.costo)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{gs(f.precio_lista)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {enEdicion ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          value={valor}
                          onChange={(e) => setValor(e.target.value)}
                          placeholder="vacío = lista"
                          className="w-32 rounded-md border border-amber-300 bg-white px-2 py-1 text-right text-sm tabular-nums"
                        />
                      ) : propio ? (
                        <span className="font-bold tabular-nums text-slate-900">{gs(f.precio_deposito!)}</span>
                      ) : (
                        <span className="text-xs text-slate-400">cobra la lista</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {f.diferencia_pct == null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className={f.diferencia_pct < 0 ? "text-rose-600" : f.diferencia_pct > 0 ? "text-emerald-700" : "text-slate-500"}>
                          {pct(f.diferencia_pct)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {f.stock_deposito == null ? (
                        <span title="Este producto no está desglosado por depósito" className="text-slate-400">
                          sin desglose
                        </span>
                      ) : (
                        f.stock_deposito
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!isAdmin ? null : enEdicion ? (
                        <div className="inline-flex gap-3">
                          <button
                            onClick={() => void guardar(f, valor)}
                            disabled={guardando}
                            className="text-xs text-emerald-700 underline hover:text-emerald-900 disabled:opacity-50"
                          >
                            {guardando ? "Guardando…" : "Guardar"}
                          </button>
                          <button
                            onClick={() => { setEditando(null); setValor(""); }}
                            disabled={guardando}
                            className="text-xs text-slate-500 underline hover:text-slate-800"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditando(f.producto_id);
                            setValor(f.precio_deposito != null ? String(f.precio_deposito) : "");
                            setError(null);
                          }}
                          className="text-xs text-sky-700 underline hover:text-sky-900"
                        >
                          {propio ? "Cambiar" : "Poner precio"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-slate-400">
        Dejar el precio <strong>vacío</strong> borra la excepción: ese depósito vuelve a cobrar la
        lista. <strong>&quot;Sin desglose&quot;</strong> quiere decir que el producto tiene stock
        pero todavía no está repartido por depósito — se reparte con un movimiento de inventario
        hacia el depósito. Caja usa este precio cuando el cajero elige este depósito al vender.
      </p>
    </div>
  );
}
