"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

/**
 * Cargar el recibo que entregó el proveedor al cobrar el cheque.
 *
 * ── LOS TRES DATOS, JUNTOS ─────────────────────────────────────────────────
 *   Número de cheque, número de recibo y fecha. Van juntos porque juntos son
 *   la prueba: el recibo del proveedor dice qué cheque cobró y cuándo.
 *
 *   Joaquín: "hay proveedores que traspapelan los documentos, entonces te
 *   piden de vuelta el cobro de esa factura como que vos estabas deudando".
 *   Lo que termina esa discusión es el número del recibo que emitió ÉL.
 *
 * ── EL NÚMERO DE RECIBO ES OBLIGATORIO, EL ARCHIVO NO ──────────────────────
 *   El número se puede leer por teléfono y resuelve el reclamo solo. El papel
 *   escaneado es mejor, pero exigirlo frenaría la carga cuando el escáner no
 *   está a mano, y un recibo sin cargar no prueba nada.
 */
export default function CargarReciboChequeModal({
  chequeId, numeroCheque, importe, moneda, proveedor, onClose, onCargado,
}: {
  chequeId: string;
  numeroCheque: string | null;
  importe: number;
  moneda: string;
  proveedor: string;
  onClose: () => void;
  onCargado: (mensaje: string) => void;
}) {
  const [numeroRecibo, setNumeroRecibo] = useState("");
  const [cheque, setCheque] = useState(numeroCheque ?? "");
  const [fecha, setFecha] = useState(() => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10));
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!numeroRecibo.trim()) {
      setError("Cargá el número del recibo: es el dato con el que se le responde al proveedor que reclama.");
      return;
    }
    if (!cheque.trim()) {
      setError("Cargá el número del cheque: sin él, el recibo no prueba qué se pagó.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("cheque_id", chequeId);
      fd.append("numero_recibo", numeroRecibo.trim());
      fd.append("numero_cheque", cheque.trim());
      fd.append("fecha_recibo", fecha);
      if (archivo) fd.append("file", archivo);

      const r = await apiFetch("/api/cheques/recibo", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      const n = Number(j.data?.facturas_saldadas ?? 0);
      onCargado(
        `Recibo N° ${j.data?.numero_recibo} cargado sobre el cheque N° ${j.data?.numero_cheque}. ` +
        `${n} ${n === 1 ? "factura quedó saldada" : "facturas quedaron saldadas"}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el recibo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Recibo del proveedor</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {proveedor} · {moneda === "USD" ? "US$ " : "Gs. "}
          {Math.round(importe).toLocaleString("es-PY")}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="text-[11px] font-medium text-slate-500">
              N° de recibo
            </span>
            <input
              value={numeroRecibo}
              onChange={(e) => { setNumeroRecibo(e.target.value); setError(null); }}
              placeholder="El que puso el proveedor"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              autoFocus
            />
          </label>
          <label>
            <span className="text-[11px] font-medium text-slate-500">
              N° de cheque
            </span>
            <input
              value={cheque}
              onChange={(e) => { setCheque(e.target.value); setError(null); }}
              placeholder="Ej: 0001234"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-[11px] font-medium text-slate-500">
            Fecha del recibo
          </span>
          <input
            type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-[10px] text-slate-400">
            Puede no ser la del cheque: se hace un día y el proveedor pasa a retirarlo otro.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] font-medium text-slate-500">
            El papel <span className="font-normal normal-case text-slate-400">(opcional)</span>
          </span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-[11px] text-slate-600 file:mr-2 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-slate-600"
          />
        </label>

        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
          Al guardar, las facturas de este cheque quedan <strong>pagadas</strong>, con el número de
          cheque y el de recibo escritos en la referencia. Es lo que se le muestra al proveedor que
          vuelve a reclamar una factura.
        </p>

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
            type="button" onClick={() => void guardar()} disabled={guardando}
            className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar el recibo"}
          </button>
        </div>
      </div>
    </div>
  );
}
