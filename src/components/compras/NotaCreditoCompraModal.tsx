"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Modal para cargar una nota de crédito recibida del proveedor e imputarla a una
 * compra (por numero_control). Reutilizable desde /pagos (Por Pagar) y desde la
 * lista de Compras. Pega contra POST /api/compras/notas-credito.
 */
export default function NotaCreditoCompraModal({
  proveedorId,
  proveedorNombre,
  numeroControl,
  total,
  moneda = "PYG",
  onClose,
  onExito,
}: {
  proveedorId?: string | null;
  proveedorNombre: string;
  numeroControl: string;
  total?: number;
  moneda?: "PYG" | "USD";
  onClose: () => void;
  onExito: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [numeroNc, setNumeroNc] = useState("");
  const [timbrado, setTimbrado] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose, saving]);

  const montoNum = Number(monto) || 0;
  const fmtGs = (n: number) =>
    (moneda === "USD" ? "USD " : "Gs. ") + new Intl.NumberFormat("es-PY").format(Math.round(Number(n) || 0));

  async function guardar() {
    if (saving) return;
    if (!(montoNum > 0)) { setError("Ingresá el monto de la nota de crédito."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/compras/notas-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId || null,
          proveedor_nombre: proveedorNombre || null,
          compra_numero_control: numeroControl,
          numero_nc: numeroNc.trim() || null,
          nro_timbrado: timbrado.trim() || null,
          fecha,
          monto: montoNum,
          motivo: motivo.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar la nota de crédito.");
        return;
      }
      onExito();
    } catch {
      setError("Error de red al guardar la nota de crédito.");
    } finally {
      setSaving(false);
    }
  }

  const inCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
  const lbCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Nota de crédito del proveedor</h3>
          <p className="text-xs text-slate-500">
            Se imputa a la compra <span className="font-mono">{numeroControl}</span> · {proveedorNombre}
            {typeof total === "number" ? <> · Total: {fmtGs(total)}</> : null}
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbCls}>N° de la nota de crédito</label>
              <input value={numeroNc} onChange={(e) => setNumeroNc(e.target.value)} className={inCls} placeholder="Ej: 001-001-0000123" />
            </div>
            <div>
              <label className={lbCls}>Timbrado</label>
              <input value={timbrado} onChange={(e) => setTimbrado(e.target.value)} className={inCls} />
            </div>
            <div>
              <label className={lbCls}>Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inCls} />
            </div>
            <div>
              <label className={lbCls}>Monto ({moneda === "USD" ? "USD" : "Gs."})</label>
              <input type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} className={inCls} placeholder="0" />
            </div>
            <div className="sm:col-span-2">
              <label className={lbCls}>Motivo</label>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inCls} placeholder="Ej: 3 productos rechazados" />
            </div>
          </div>
          {typeof total === "number" && montoNum > total && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              El monto supera el saldo de la compra; se descontará todo el saldo (quedará en 0).
            </div>
          )}
          {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "Guardando…" : "Imputar nota de crédito"}
          </button>
        </div>
      </div>
    </div>
  );
}
