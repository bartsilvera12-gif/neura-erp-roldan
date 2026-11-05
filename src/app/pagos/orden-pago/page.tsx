"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import SearchableSelect from "@/components/ui/SearchableSelect";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import CargarReciboChequeModal from "@/components/pagos/CargarReciboChequeModal";
import { Printer, FileCheck2, Banknote } from "lucide-react";

/**
 * Orden de pago consolidada.
 *
 * ── PARA QUÉ EXISTE ────────────────────────────────────────────────────────
 *   Se eligen varias facturas de un proveedor, se emite UN cheque por el
 *   total, se imprime la orden que las detalla, y cuando el proveedor entrega
 *   su recibo se carga acá con su número.
 *
 *   Joaquín: "hay proveedores que traspapelan los documentos, entonces te
 *   piden de vuelta el cobro de esa factura como que vos estabas deudando".
 *   El número de recibo —que lo emite ÉL— es lo que termina esa discusión.
 */

type Factura = {
  numero_control: string;
  numero_factura: string | null;
  fecha: string | null;
  vencimiento: string | null;
  moneda: string;
  total: number;
  vencida: boolean;
};

type Cheque = {
  id: string; numero: string | null; numero_recibo?: string | null;
  fecha_recibo?: string | null; recibo_storage_path?: string | null;
  banco_nombre: string | null; moneda: string; importe: number; estado: string;
  proveedor_nombre: string;
};

const gs = (v: number, m?: string) =>
  `${m === "USD" ? "US$ " : "Gs. "}${Math.round(v).toLocaleString("es-PY")}`;
const fmt = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
const hoyPy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

export default function OrdenPagoPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [numeroCheque, setNumeroCheque] = useState("");
  const [banco, setBanco] = useState("");
  const [fechaPago, setFechaPago] = useState(hoyPy);
  const [emitiendo, setEmitiendo] = useState(false);

  const [chequeCreado, setChequeCreado] = useState<Cheque | null>(null);
  const [cargandoRecibo, setCargandoRecibo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { void getProveedores().then(setProveedores); }, []);

  /**
   * Se puede llegar con el proveedor ya elegido: /pagos/orden-pago?proveedor=<id>
   *
   * Es como se entra desde Pagos a proveedores, que es donde se ve a quién hay
   * que pagarle. Sin esto había que acordarse de que esta pantalla existe y
   * volver a buscar el proveedor en el selector, y por eso el botón que estaba
   * en la lista imprimía la orden de UNA factura en vez de la consolidada, que
   * es justo lo que se había pedido.
   *
   * Se lee de `window.location` y no con useSearchParams a propósito: ese hook
   * obliga a envolver la página en un Suspense para poder prerenderizarla, y
   * acá no hace falta tanto para leer un parámetro una sola vez.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("proveedor");
    if (id) setProveedorId(id);
  }, []);

  const cargar = useCallback(async () => {
    if (!proveedorId) { setFacturas([]); return; }
    setCargando(true);
    setError(null);
    setElegidas(new Set());
    try {
      const r = await apiFetch(`/api/pagos/orden-pago?proveedor_id=${encodeURIComponent(proveedorId)}`);
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudieron cargar las facturas.");
      setFacturas((j.data?.facturas ?? []) as Factura[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
      setFacturas([]);
    } finally {
      setCargando(false);
    }
  }, [proveedorId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;
  const seleccionadas = useMemo(
    () => facturas.filter((f) => elegidas.has(f.numero_control)),
    [facturas, elegidas]
  );
  const total = seleccionadas.reduce((s, f) => s + f.total, 0);
  // Un cheque tiene UNA moneda: mezclarlas daría un importe sin sentido.
  const monedas = new Set(seleccionadas.map((f) => f.moneda));
  const mezcladas = monedas.size > 1;
  const moneda = monedas.size === 1 ? [...monedas][0] : "PYG";

  function alternar(nc: string) {
    setElegidas((prev) => {
      const n = new Set(prev);
      if (n.has(nc)) n.delete(nc); else n.add(nc);
      return n;
    });
  }

  async function emitir() {
    if (!proveedor || seleccionadas.length === 0) return;
    if (mezcladas) { setError("Las facturas elegidas están en monedas distintas: hacé un pago para cada moneda."); return; }
    setEmitiendo(true);
    setError(null);
    try {
      const r = await apiFetch("/api/cheques", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedor.id,
          proveedor_nombre: proveedor.nombre,
          moneda,
          importe: total,
          numero: numeroCheque.trim() || null,
          banco_nombre: banco.trim() || null,
          fecha_pago_prevista: fechaPago,
          facturas: seleccionadas.map((f) => ({
            numero_control: f.numero_control,
            importe_imputado: f.total,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const id = String(j.data?.cheque_id ?? "");

      const det = await apiFetch(`/api/pagos/orden-pago?cheque_id=${encodeURIComponent(id)}`);
      const dj = await det.json();
      setChequeCreado((dj?.data?.cheque ?? null) as Cheque | null);
      setAviso(
        `Pago armado por ${gs(total, moneda)} sobre ${seleccionadas.length} ` +
        `${seleccionadas.length === 1 ? "factura" : "facturas"}. Imprimí la orden y hacé firmar el recibo.`
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el pago.");
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        eyebrow="Pagos"
        title="Orden de pago"
        description="Varias facturas de un proveedor en un solo cheque, con su recibo firmado"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedor</span>
          <SearchableSelect
            value={proveedorId}
            onChange={(v) => { setProveedorId(v); setChequeCreado(null); setAviso(null); }}
            options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
            placeholder="Buscá el proveedor…"
            className="w-72"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {/* ── El pago recién armado ─────────────────────────────────────── */}
      {chequeCreado && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">{aviso}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={`/api/pagos/orden-pago/imprimir?cheque_id=${chequeCreado.id}`}
              target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50"
            >
              <Printer className="h-4 w-4" /> Imprimir la orden
            </a>
            <button
              type="button" onClick={() => setCargandoRecibo(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
            >
              <FileCheck2 className="h-4 w-4" /> Cargar el recibo del proveedor
            </button>
            {chequeCreado.numero_recibo && (
              <span className="text-xs text-emerald-800">
                Recibo N° <strong>{chequeCreado.numero_recibo}</strong> · {fmt(chequeCreado.fecha_recibo ?? null)}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-emerald-800">
            Imprimí dos: una queda firmada en la carpeta y la otra se la lleva el proveedor. Las
            facturas se marcan como pagadas al cargar el recibo, no antes: el cheque puede estar
            hecho y todavía no entregado.
          </p>
        </div>
      )}

      {/* ── Las facturas pendientes ───────────────────────────────────── */}
      {!proveedorId ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <Banknote className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 font-medium text-slate-700">Elegí un proveedor</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Se listan sus facturas a crédito pendientes. Las que ya tienen un cheque no aparecen,
            para que no se pueda pagar dos veces la misma.
          </p>
        </div>
      ) : cargando ? (
        <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
      ) : facturas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
          <p className="font-medium text-slate-700">
            {proveedor?.nombre} no tiene facturas pendientes sin cheque.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <EdgeScrollArea>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={elegidas.size === facturas.length && facturas.length > 0}
                        onChange={(e) =>
                          setElegidas(e.target.checked ? new Set(facturas.map((f) => f.numero_control)) : new Set())
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">N° factura</th>
                    <th className="px-3 py-2 text-left font-semibold">N° carga</th>
                    <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                    <th className="px-3 py-2 text-left font-semibold">Vencimiento</th>
                    <th className="px-3 py-2 text-right font-semibold">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((f) => (
                    <tr
                      key={f.numero_control}
                      onClick={() => alternar(f.numero_control)}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                        elegidas.has(f.numero_control) ? "bg-[#4FAEB2]/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox" checked={elegidas.has(f.numero_control)}
                          onChange={() => alternar(f.numero_control)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{f.numero_factura ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{f.numero_control}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmt(f.fecha)}</td>
                      <td className={`px-3 py-2.5 ${f.vencida ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                        {fmt(f.vencimiento)}{f.vencida && " · vencida"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                        {gs(f.total, f.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </EdgeScrollArea>
          </div>

          {/* ── Armar el cheque ────────────────────────────────────────── */}
          {seleccionadas.length > 0 && (
            <div className="rounded-xl border border-[#4FAEB2] bg-[#4FAEB2]/5 p-4">
              <p className="text-sm font-semibold text-[#2F6E71]">
                {seleccionadas.length} {seleccionadas.length === 1 ? "factura" : "facturas"} ·{" "}
                {gs(total, moneda)} en un cheque
              </p>

              {mezcladas && (
                <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                  Elegiste facturas en guaraníes y en dólares. Un cheque tiene una sola moneda y un
                  solo importe: hacé un pago para cada una.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    N° de cheque <span className="font-normal normal-case text-slate-400">(se puede cargar después)</span>
                  </span>
                  <input
                    value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)}
                    placeholder="Ej: 0001234"
                    className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Banco</span>
                  <input
                    value={banco} onChange={(e) => setBanco(e.target.value)}
                    placeholder="Ej: Itaú"
                    className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de pago</span>
                  <input
                    type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button" onClick={() => void emitir()}
                  disabled={emitiendo || mezcladas}
                  className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                >
                  {emitiendo ? "Armando…" : "Armar el pago"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {cargandoRecibo && chequeCreado && (
        <CargarReciboChequeModal
          chequeId={chequeCreado.id}
          numeroCheque={chequeCreado.numero}
          importe={chequeCreado.importe}
          moneda={chequeCreado.moneda}
          proveedor={chequeCreado.proveedor_nombre}
          onClose={() => setCargandoRecibo(false)}
          onCargado={(m) => {
            setCargandoRecibo(false);
            setAviso(m);
            setChequeCreado(null);
            void cargar();
          }}
        />
      )}

      <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-500">
        <p>
          Las facturas que ya tienen un cheque <strong>no se listan</strong>: es lo que evita armar
          un segundo pago por algo ya pagado.
        </p>
        <p>
          Las facturas pasan a <strong>pagadas</strong> al cargar el recibo, no al emitir el cheque.
          Un cheque hecho puede no haberse entregado todavía; el recibo es la constancia de que el
          proveedor lo recibió.
        </p>
        <p>
          El <strong>número de recibo lo emite el proveedor</strong>. Es el dato que termina la
          discusión cuando vuelve a reclamar una factura que dice no tener registrada.
        </p>
      </div>
    </div>
  );
}
