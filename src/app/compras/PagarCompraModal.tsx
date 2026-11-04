"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  MEDIOS_PAGO_COMPRA,
  resultadoDelPago,
  type MedioPagoCompra,
} from "@/lib/compras/pago-caja";

/**
 * Pagar una compra desde el listado.
 *
 * ── POR QUÉ NO ALCANZABA CON LO QUE HABÍA ──────────────────────────────────
 *   Marcar la compra como pagada ya descontaba la plata del turno abierto,
 *   pero no había forma de llegar ahí: el listado tenía Anular y Eliminar y
 *   nada más. La única manera era pegarle a la API a mano.
 *
 * ── LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARO ────────────────────────────
 *   Cuál de los cuatro medios sale del cajón y cuál no. Un cheque o una
 *   transferencia quedan registrados en el turno pero NO bajan el efectivo
 *   esperado del arqueo, porque salen del banco. Decirlo antes de apretar
 *   evita la discusión de después, cuando el cajero cuente bien y el sistema
 *   le marque un faltante.
 */
export default function PagarCompraModal({
  numero, proveedor, total, moneda, onClose, onPagada,
}: {
  numero: string;
  proveedor: string;
  total: number;
  moneda: string;
  onClose: () => void;
  onPagada: (aviso: { nivel: "ok" | "aviso"; mensaje: string }) => void;
}) {
  const [medio, setMedio] = useState<MedioPagoCompra>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = MEDIOS_PAGO_COMPRA.find((m) => m.clave === medio)!;
  // El número de cheque no es un adorno: sin él no se puede conciliar después.
  const pideReferencia = medio === "cheque" || medio === "transferencia";

  async function pagar() {
    if (pideReferencia && !referencia.trim()) {
      setError(medio === "cheque"
        ? "Cargá el número del cheque."
        : "Cargá el número de la transferencia.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/compras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: numero,
          estado: "pagada",
          metodo_pago: medio,
          referencia_pago: referencia.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      onPagada(resultadoDelPago({
        medio,
        cajaMovimientoId: j.data?.caja_movimiento_id ?? null,
        numeroControl: numero,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900">Pagar {numero}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {proveedor} · {moneda === "USD" ? "US$ " : "Gs. "}
          {total.toLocaleString("es-PY")}
        </p>

        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Método de pago
        </label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {MEDIOS_PAGO_COMPRA.map((m) => (
            <button
              key={m.clave}
              type="button"
              onClick={() => { setMedio(m.clave); setError(null); }}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                medio === m.clave
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* El aviso cambia con el medio: es la diferencia entre que el arqueo
            lo espere o no, y nadie debería tener que deducirla. */}
        <p className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${
          info.saleDelCajon
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {info.nota}
        </p>

        {pideReferencia && (
          <label className="mt-3 block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {medio === "cheque" ? "Número de cheque" : "Número de transferencia"}
            </span>
            <input
              value={referencia}
              onChange={(e) => { setReferencia(e.target.value); setError(null); }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={medio === "cheque" ? "Ej: 0001234" : "Ej: TRF-99812"}
            />
          </label>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void pagar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Registrando…" : "Registrar el pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
