"use client";

import { useEffect } from "react";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  /** Deshabilita el botón confirmar (para procesos async en curso). */
  loading?: boolean;
};

/**
 * Modal de confirmación del ERP. Reemplaza al `window.confirm` nativo.
 * Cerrar por Esc o click afuera → cancel. Sin dependencias externas.
 */
export default function ConfirmModal({
  open, title, message, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  tone = "default", onConfirm, onCancel, loading = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
      if (e.key === "Enter" && !loading) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, loading, onConfirm, onCancel]);

  if (!open) return null;

  const confirmCls =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700 text-white"
      : "bg-[#4FAEB2] hover:bg-[#3F9EA2] text-white";

  const iconTone =
    tone === "danger"
      ? "bg-rose-50 text-rose-600"
      : "bg-[#E5F4F4] text-[#3F8E91]";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3"
      onClick={() => !loading && onCancel()}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full ${iconTone}`}>
              {tone === "danger" ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495ZM10 6.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V7.5a.75.75 0 0 1 .75-.75Zm0 7.25a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.25v3.25a.75.75 0 0 0 1.5 0V9.75A.75.75 0 0 0 10 9H9Z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {message && <p className="mt-1 text-sm text-slate-600">{message}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 rounded-b-2xl">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${confirmCls}`}
          >
            {loading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
