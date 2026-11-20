"use client";

import { useEffect, useRef } from "react";
import { Banknote, CalendarClock, CreditCard, FileText, Landmark, Layers, Loader2, Receipt, UserRound, X } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";

/**
 * «Finalizar venta», al estilo de la caja de JM (pedido del cliente): todo el
 * cobro en un solo lugar y por teclado.
 *
 *   1. Comprobante: factura (con el nombre del cliente o sin nombre) o ticket.
 *   2. Forma de pago: efectivo, transferencia, tarjeta, mixto o crédito.
 *   3. Efectivo: «Paga con», con los montos de un toque, y el vuelto grande.
 *
 * Enter confirma, ←/→ cambian la forma de pago, Esc cierra.
 *
 * El modal no guarda nada propio: maneja los mismos estados de la pantalla de
 * Nueva venta, así que lo que se elige acá es lo que se manda al confirmar.
 */
export type FormaPago = "efectivo" | "transferencia" | "tarjeta" | "mixto" | "credito";

const FORMAS: Array<{ v: FormaPago; label: string; Icon: typeof Banknote }> = [
  { v: "efectivo", label: "Efectivo", Icon: Banknote },
  { v: "transferencia", label: "Transferencia", Icon: Landmark },
  { v: "tarjeta", label: "Tarjeta", Icon: CreditCard },
  { v: "mixto", label: "Mixto", Icon: Layers },
  { v: "credito", label: "Crédito", Icon: CalendarClock },
];

const fmt = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

/** Billetes redondos por encima del total, para cobrar de un toque. */
function montosRapidos(total: number): number[] {
  const out = new Set<number>();
  for (const b of [10_000, 20_000, 50_000, 100_000]) {
    const m = Math.ceil(total / b) * b;
    if (m > total) out.add(m);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export default function FinalizarVentaModal(props: {
  total: number;
  cantidadItems: number;
  forma: FormaPago;
  onForma: (f: FormaPago) => void;
  /** Comprobante. `factura` solo si la empresa factura (SIFEN o autoimpresor). */
  puedeFacturar: boolean;
  tipoDocumento: "factura" | "ticket";
  onTipoDocumento: (t: "factura" | "ticket") => void;
  clienteNombre: string | null;
  /** Efectivo */
  montoRecibido: string;
  onMontoRecibido: (v: string) => void;
  registrarDiferencia: boolean;
  onRegistrarDiferencia: (v: boolean) => void;
  /** Transferencia / tarjeta: abre el detalle (entidad, comprobante). */
  resumenPago: string | null;
  onEditarPago: () => void;
  /** Crédito */
  plazoDias: string;
  onPlazoDias: (v: string) => void;
  creditoAviso: string | null;
  /** Mixto: el editor de la pantalla, tal cual. */
  editorMixto: React.ReactNode;
  puedeConfirmar: boolean;
  guardando: boolean;
  error: string | null;
  onConfirmar: () => void;
  onClose: () => void;
}) {
  const p = props;
  const pagaConRef = useRef<HTMLInputElement | null>(null);
  const recibido = parseFloat(p.montoRecibido) || 0;
  const vuelto = recibido - p.total;

  useEffect(() => {
    if (p.forma === "efectivo") setTimeout(() => pagaConRef.current?.focus(), 50);
  }, [p.forma]);

  function onKeyDown(e: React.KeyboardEvent) {
    const enCampo = (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA";
    if (e.key === "Escape") { e.preventDefault(); p.onClose(); return; }
    if (e.key === "Enter" && !(e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      if (p.puedeConfirmar && !p.guardando) p.onConfirmar();
      return;
    }
    if (!enCampo && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const i = FORMAS.findIndex((f) => f.v === p.forma);
      const n = (i + (e.key === "ArrowRight" ? 1 : -1) + FORMAS.length) % FORMAS.length;
      p.onForma(FORMAS[n]!.v);
    }
  }

  const sinNombre = !p.clienteNombre;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !p.guardando) p.onClose(); }}>
      <div className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Finalizar venta · {fmt(p.total)}</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {p.cantidadItems} {p.cantidadItems === 1 ? "producto" : "productos"} · Enter confirma, ←/→ cambian la forma de pago
            </p>
          </div>
          <button type="button" onClick={p.onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Cerrar (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {/* 1 · Comprobante */}
          <section>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px]">1</span> Comprobante
            </p>
            <div className="grid grid-cols-2 gap-2">
              {p.puedeFacturar && (
                <button type="button" onClick={() => p.onTipoDocumento("factura")}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${p.tipoDocumento === "factura" ? "border-[#4FAEB2] bg-[#4FAEB2]/10" : "border-slate-200 hover:border-[#4FAEB2]/50"}`}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    {sinNombre ? <FileText className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                    {sinNombre ? "Factura sin nombre" : "Factura con nombre"}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {sinNombre ? "consumidor final · talonario" : `${p.clienteNombre} · talonario`}
                  </span>
                </button>
              )}
              <button type="button" onClick={() => p.onTipoDocumento("ticket")}
                className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${p.puedeFacturar ? "" : "col-span-2"} ${p.tipoDocumento === "ticket" || !p.puedeFacturar ? "border-[#4FAEB2] bg-[#4FAEB2]/10" : "border-slate-200 hover:border-[#4FAEB2]/50"}`}>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Receipt className="h-4 w-4" /> Ticket</span>
                <span className="block text-[11px] text-slate-500">interno · sin factura</span>
              </button>
            </div>
            {sinNombre && p.puedeFacturar && (
              <p className="mt-1.5 text-[11px] text-slate-400">Para facturar con nombre, elegí el cliente arriba, en «Datos de la venta».</p>
            )}
          </section>

          {/* 2 · Forma de pago */}
          <section>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px]">2</span> Forma de pago
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {FORMAS.map(({ v, label, Icon }) => {
                const on = p.forma === v;
                const deshabilitado = v === "credito" && sinNombre;
                return (
                  <button key={v} type="button" disabled={deshabilitado} onClick={() => p.onForma(v)}
                    title={deshabilitado ? "El crédito necesita un cliente" : undefined}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      on ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]" : "border-slate-200 text-slate-600 hover:border-[#4FAEB2]/50"
                    }`}>
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>

            {p.forma === "efectivo" && (
              <div className="mt-4 space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Paga con</label>
                <div ref={(el) => { pagaConRef.current = el?.querySelector("input") ?? null; }}>
                  <MontoInput
                    value={p.montoRecibido}
                    onChange={(n) => p.onMontoRecibido(String(n))}
                    placeholder={fmt(p.total)}
                    decimals={false}
                    className="w-full rounded-xl border-2 border-[#4FAEB2] px-4 py-3 text-2xl font-semibold tabular-nums outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => p.onMontoRecibido(String(Math.round(p.total)))}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Exacto</button>
                  {montosRapidos(p.total).map((m) => (
                    <button key={m} type="button" onClick={() => p.onMontoRecibido(String(m))}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium tabular-nums text-slate-700 hover:bg-slate-50">{fmt(m)}</button>
                  ))}
                </div>
                {recibido > 0 && (
                  <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${vuelto >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                    <span className={`text-sm font-medium ${vuelto >= 0 ? "text-emerald-800" : "text-red-700"}`}>{vuelto >= 0 ? "Vuelto" : "Falta"}</span>
                    <span className={`text-3xl font-bold tabular-nums ${vuelto >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(Math.abs(vuelto))}</span>
                  </div>
                )}
                {recibido > 0 && Math.round(vuelto) !== 0 && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <input type="checkbox" checked={p.registrarDiferencia} onChange={(e) => p.onRegistrarDiferencia(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4FAEB2]" />
                    <span>
                      {vuelto > 0
                        ? <>No se da el vuelto: registrar <strong>{fmt(vuelto)}</strong> como sobrante de caja.</>
                        : <>Se acepta lo recibido: registrar <strong>{fmt(-vuelto)}</strong> como faltante de caja.</>}
                    </span>
                  </label>
                )}
              </div>
            )}

            {(p.forma === "transferencia" || p.forma === "tarjeta") && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <span className="min-w-0 truncate text-slate-600">{p.resumenPago ?? "Sin datos del pago todavía"}</span>
                <button type="button" onClick={p.onEditarPago} className="shrink-0 font-medium text-sky-700 hover:underline">Datos del pago</button>
              </div>
            )}

            {p.forma === "mixto" && <div className="mt-4">{p.editorMixto}</div>}

            {p.forma === "credito" && (
              <div className="mt-4 space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Plazo (días)</label>
                <input type="number" min={1} value={p.plazoDias} onChange={(e) => p.onPlazoDias(e.target.value)}
                  className="w-32 rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]" />
                {p.creditoAviso && <p className="text-xs text-slate-600">{p.creditoAviso}</p>}
              </div>
            )}
          </section>

          {p.error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{p.error}</p>}
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button type="button" onClick={p.onClose} disabled={p.guardando}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Volver</button>
          <button type="button" onClick={p.onConfirmar} disabled={!p.puedeConfirmar || p.guardando}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] px-5 py-3 text-base font-bold text-white hover:bg-[#3F8E91] disabled:opacity-40">
            {p.guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {p.guardando ? "Guardando…" : `Cobrar ${fmt(p.total)}`}
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">Enter</span>
          </button>
        </div>
      </div>
    </div>
  );
}
