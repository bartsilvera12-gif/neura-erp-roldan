"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";

/**
 * Nueva orden de compra, al estilo de la captura que mandó el cliente:
 *
 *   1. Proveedor y condiciones: proveedor (opcional), entrega esperada,
 *      contado o crédito, guaraníes o dólares.
 *   2. Productos a pedir: se buscan (o escanean) del inventario y se ve su
 *      stock, su mínimo y su último costo; o se escribe uno a mano.
 *   A la derecha, el resumen y «Crear orden de compra».
 *
 * La orden no mueve stock: eso pasa al cargar la factura (botón «Cargar
 * factura» en el listado), que arma la compra con estos mismos datos.
 */

type Hit = { id: string; nombre: string; sku: string | null; stock_actual: number; stock_minimo: number; costo_promedio: number; unidad_medida: string };
type Linea = { producto_id: string | null; sku: string | null; descripcion: string; unidad: string; cantidad: string; costo: string; stock: number | null; minimo: number | null; ultimo: number | null };

const fmt = (n: number, usd = false) => (usd ? "USD " : "Gs. ") + (usd ? n.toLocaleString("es-PY", { maximumFractionDigits: 2 }) : Math.round(n).toLocaleString("es-PY"));
const numero = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;

export default function NuevaOrdenCompraPage() {
  const router = useRouter();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [provQ, setProvQ] = useState("");
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [provAbierto, setProvAbierto] = useState(false);
  const [entrega, setEntrega] = useState("");
  const [condicion, setCondicion] = useState<"contado" | "credito">("contado");
  const [moneda, setMoneda] = useState<"PYG" | "USD">("PYG");
  const [obs, setObs] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [marcado, setMarcado] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buscarRef = useRef<HTMLInputElement>(null);
  const cantRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => { void getProveedores().then(setProveedores); }, []);

  const provFiltrados = useMemo(() => {
    const t = provQ.trim().toLowerCase();
    if (!t) return proveedores.slice(0, 30);
    return proveedores.filter((p) => p.nombre.toLowerCase().includes(t) || String(p.ruc ?? "").includes(t)).slice(0, 30);
  }, [proveedores, provQ]);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const id = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/productos/search?q=${encodeURIComponent(t)}&limit=20`, { credentials: "include" });
        const j = await r.json();
        setHits(((j?.data?.items ?? []) as Hit[]));
        setMarcado(0);
      } catch { setHits([]); } finally { setBuscando(false); }
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  function agregar(h: Hit) {
    const ya = lineas.findIndex((l) => l.producto_id === h.id);
    if (ya >= 0) {
      setLineas((prev) => prev.map((l, i) => (i === ya ? { ...l, cantidad: String(numero(l.cantidad) + 1) } : l)));
      setTimeout(() => cantRefs.current[ya]?.select(), 30);
    } else {
      // Sugerencia: lo que falta para llegar al mínimo (si falta algo).
      const falta = Math.max(1, Math.ceil(h.stock_minimo - h.stock_actual));
      setLineas((prev) => [...prev, {
        producto_id: h.id, sku: h.sku, descripcion: h.nombre, unidad: h.unidad_medida || "UNIDAD",
        cantidad: String(h.stock_minimo > h.stock_actual ? falta : 1),
        costo: h.costo_promedio > 0 ? String(Math.round(h.costo_promedio)) : "",
        stock: h.stock_actual, minimo: h.stock_minimo, ultimo: h.costo_promedio || null,
      }]);
      const idx = lineas.length;
      setTimeout(() => cantRefs.current[idx]?.select(), 30);
    }
    setQ("");
    setHits([]);
  }

  function manual() {
    const t = q.trim();
    setLineas((prev) => [...prev, { producto_id: null, sku: null, descripcion: t.toUpperCase(), unidad: "UNIDAD", cantidad: "1", costo: "", stock: null, minimo: null, ultimo: null }]);
    setQ("");
  }

  const unidades = lineas.reduce((s, l) => s + numero(l.cantidad), 0);
  const total = lineas.reduce((s, l) => s + numero(l.cantidad) * numero(l.costo), 0);
  const falta = lineas.length === 0 ? "al menos un producto" : lineas.some((l) => !l.descripcion.trim() || numero(l.cantidad) <= 0) ? "la cantidad de cada producto" : null;

  async function crear() {
    if (falta) { setError(`Falta ${falta}.`); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedor?.id ?? null,
          proveedor_nombre: proveedor?.nombre ?? null,
          moneda, condicion,
          fecha_entrega: entrega || null,
          observaciones: obs.trim() || null,
          items: lineas.map((l) => ({
            descripcion: l.descripcion.trim(), cantidad: numero(l.cantidad), unidad: l.unidad,
            precio_unitario: numero(l.costo), producto_id: l.producto_id, sku: l.sku,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const o = j.data?.orden as { id?: string } | undefined;
      if (o?.id) window.open(`/api/ordenes-compra/imprimir?id=${o.id}`, "_blank");
      router.push("/ordenes-compra");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la orden.");
      setGuardando(false);
    }
  }

  const seg = (on: boolean) => `flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${on ? "bg-white text-sky-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`;
  const caja = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const num = (n: number) => <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white">{n}</span>;

  return (
    <div className="max-w-7xl space-y-4">
      <div>
        <Link href="/ordenes-compra" className="text-sm text-sky-600 hover:underline">← Órdenes de compra</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Nueva orden de compra</h1>
        <p className="text-sm text-slate-500">El pedido al proveedor. No mueve el stock: eso pasa cuando se carga la factura.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className={caja}>
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">{num(1)} Proveedor y condiciones</h2>
            <label className="mb-1 block text-sm text-slate-600">Proveedor <span className="text-slate-400">(opcional)</span></label>
            {proveedor ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5">
                <span className="font-medium text-slate-800">{proveedor.nombre}</span>
                <button type="button" onClick={() => { setProveedor(null); setProvQ(""); }} className="text-sm text-sky-600 hover:underline">Cambiar</button>
              </div>
            ) : (
              <div className="relative">
                <input value={provQ} onChange={(e) => { setProvQ(e.target.value); setProvAbierto(true); }} onFocus={() => setProvAbierto(true)}
                  onBlur={() => setTimeout(() => setProvAbierto(false), 150)}
                  placeholder="Buscar proveedor… (se puede dejar vacío)" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-sky-400" />
                {provAbierto && provFiltrados.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {provFiltrados.map((p) => (
                      <li key={p.id}>
                        <button type="button" onMouseDown={() => { setProveedor(p); setProvAbierto(false); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-sky-50">
                          {p.nombre} {p.ruc ? <span className="text-xs text-slate-400">· {p.ruc}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">Entrega esperada <span className="text-slate-400">(opcional)</span></span>
                <input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-sky-400" />
              </label>
              <div>
                <span className="mb-1 block text-sm text-slate-600">Condición</span>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  <button type="button" className={seg(condicion === "contado")} onClick={() => setCondicion("contado")}>Contado</button>
                  <button type="button" className={seg(condicion === "credito")} onClick={() => setCondicion("credito")}>Crédito</button>
                </div>
              </div>
              <div>
                <span className="mb-1 block text-sm text-slate-600">Moneda</span>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  <button type="button" className={seg(moneda === "PYG")} onClick={() => setMoneda("PYG")}>Guaraníes</button>
                  <button type="button" className={seg(moneda === "USD")} onClick={() => setMoneda("USD")}>Dólares</button>
                </div>
              </div>
            </div>
          </section>

          <section className={caja}>
            <h2 className="mb-3 flex items-center justify-between gap-2 font-semibold text-slate-800">
              <span className="flex items-center gap-2">{num(2)} Productos a pedir</span>
              <span className="text-xs font-normal text-slate-400">{lineas.length} {lineas.length === 1 ? "producto" : "productos"}</span>
            </h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input ref={buscarRef} value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => Math.min(m + 1, hits.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); if (hits[marcado]) agregar(hits[marcado]); }
                }}
                placeholder="Buscá o escaneá un producto (nombre, SKU o código)…"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              {q.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {buscando ? <p className="px-4 py-2 text-xs text-slate-400">Buscando…</p> : hits.map((h, i) => (
                    <button key={h.id} type="button" onMouseDown={() => agregar(h)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-sky-50 ${i === marcado ? "bg-sky-50" : ""}`}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{h.nombre}</span>
                        <span className="text-[11px] text-slate-500">{h.sku ?? ""} · stock {h.stock_actual} · mínimo {h.stock_minimo}</span>
                      </span>
                    </button>
                  ))}
                  {!buscando && (
                    <button type="button" onMouseDown={manual} className="flex w-full items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-sky-700 hover:bg-sky-50">
                      <Plus className="h-3.5 w-3.5" /> Pedir «{q.trim()}» escrito a mano
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <div className="min-w-[200px] flex-1">
                    <p className="font-semibold text-slate-800">{l.descripcion}</p>
                    <p className="text-[11px] text-slate-500">
                      {l.producto_id
                        ? `${l.sku ?? ""} · stock ${l.stock ?? "—"} · mínimo ${l.minimo ?? "—"}${l.ultimo ? ` · última compra ${fmt(l.ultimo)}` : ""}`
                        : "Escrito a mano"}
                    </p>
                  </div>
                  <label className="w-24">
                    <span className="block text-[11px] text-slate-500">Cantidad</span>
                    <input ref={(el) => { cantRefs.current[i] = el; }} inputMode="decimal" value={l.cantidad}
                      onChange={(e) => setLineas((prev) => prev.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarRef.current?.focus(); } }}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums" />
                  </label>
                  <label className="w-32">
                    <span className="block text-[11px] text-slate-500">Costo estimado</span>
                    <input inputMode="decimal" value={l.costo}
                      onChange={(e) => setLineas((prev) => prev.map((x, k) => (k === i ? { ...x, costo: e.target.value } : x)))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarRef.current?.focus(); } }}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums" />
                  </label>
                  <span className="w-28 text-right text-sm font-bold tabular-nums">{fmt(numero(l.cantidad) * numero(l.costo), moneda === "USD")}</span>
                  <button type="button" onClick={() => setLineas((prev) => prev.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600" aria-label="Quitar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className={`${caja} h-fit space-y-3 lg:sticky lg:top-4`}>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Resumen del pedido</p>
          <div className="flex justify-between text-sm text-slate-600"><span>Productos</span><span className="tabular-nums">{lineas.length}</span></div>
          <div className="flex justify-between text-sm text-slate-600"><span>Unidades</span><span className="tabular-nums">{unidades.toLocaleString("es-PY")}</span></div>
          <div className="flex items-end justify-between border-t border-slate-100 pt-3">
            <span className="font-medium text-slate-700">Total estimado</span>
            <span className="text-2xl font-bold tabular-nums text-slate-900">{fmt(total, moneda === "USD")}</span>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Observación para el proveedor <span className="text-slate-400">(opcional)</span></span>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Ej: entregar por la mañana, en el depósito de atrás"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400" />
          </label>
          {(error || falta) && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{error ?? `Falta: ${falta}.`}</p>}
          <button type="button" onClick={() => void crear()} disabled={guardando || !!falta}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-600 disabled:opacity-40">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Crear orden de compra
          </button>
          <p className="text-center text-[11px] text-slate-400">Se abre para imprimir, sin montos: los precios los pone la factura del proveedor.</p>
        </aside>
      </div>
    </div>
  );
}
