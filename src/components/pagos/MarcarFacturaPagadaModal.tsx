"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { hoyParaguay } from "@/lib/pagos/deuda-proveedores";
import Selector from "@/components/ui/Selector";

/**
 * Marcar como pagada UNA factura de proveedor.
 *
 * Estaba dentro de la pantalla de cobros, en la pestaña que mezclaba las
 * cuentas por cobrar con las de pagar. Vive acá para usarse desde Pagos a
 * proveedores, que es donde se mira a quién hay que pagarle.
 *
 * Es también la forma de ir limpiando el histórico: la migración trajo 14.592
 * facturas como impagas, y las que en realidad ya se pagaron se van cerrando
 * desde acá.
 *
 * Para pagar VARIAS facturas con un solo cheque está la orden de pago
 * consolidada, que es otra cosa y tiene su propia pantalla.
 */
export default function MarcarFacturaPagadaModal({
  factura, onClose, onExito,
}: {
  factura: {
    numero_control: string;
    numero_factura?: string | null;
    proveedor_nombre: string;
    total: number;
    moneda?: string;
  };
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia" | "tarjeta" | "cheque">("transferencia");
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(() => hoyParaguay());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = (v: number) =>
    (factura.moneda === "USD" ? "US$ " : "Gs. ") + Math.round(Number(v) || 0).toLocaleString("es-PY");

  /** La transferencia, la tarjeta y el cheque tienen un número que lo prueba. */
  const requiereRef = metodo !== "efectivo";
  const LABEL_REF: Record<string, string> = {
    transferencia: "N° de comprobante de la transferencia",
    tarjeta: "N° de ticket de la tarjeta",
    cheque: "N° del cheque",
  };

  async function confirmar() {
    setError(null);
    if (requiereRef && !referencia.trim()) {
      setError(`Cargá el ${LABEL_REF[metodo].toLowerCase()}.`);
      return;
    }
    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/compras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: factura.numero_control,
          estado: "pagada",
          metodo_pago: metodo,
          referencia_pago: referencia.trim() || null,
          fecha_pago: fecha,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) throw new Error(j?.error ?? `Error ${res.status}`);
      await onExito();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setGuardando(false);
    }
  }

  const fld = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">Marcar la factura como pagada</h3>
        <p className="mt-1 text-xs text-slate-500">
          {factura.proveedor_nombre} · {factura.numero_factura || factura.numero_control} ·{" "}
          <strong className="text-slate-700">{fmt(factura.total)}</strong>
        </p>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{error}</p>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Cómo se pagó</span>
            <Selector
              value={metodo}
              onChange={(e) => { setMetodo(e.target.value as typeof metodo); setReferencia(""); }}
              className={fld}
            >
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
            </Selector>
          </label>

          {requiereRef && (
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">
                {LABEL_REF[metodo]}
              </span>
              <input
                value={referencia} onChange={(e) => setReferencia(e.target.value)}
                className={fld} placeholder="Queda guardado como prueba del pago"
              />
            </label>
          )}

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Fecha del pago</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={fld} />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={guardando}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={() => void confirmar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Confirmar el pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
