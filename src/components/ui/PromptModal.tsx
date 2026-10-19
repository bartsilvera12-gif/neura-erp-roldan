"use client";

import { useEffect, useState } from "react";

/**
 * Modal de input de texto del ERP. Reemplaza al `window.prompt` nativo.
 * Enter → confirmar. Esc → cancelar (retorna null).
 */
export default function PromptModal({
  open,
  title,
  message,
  placeholder,
  defaultValue = "",
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  required = false,
  multiline = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  multiline?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !multiline && !e.shiftKey) {
        e.preventDefault();
        if (!required || value.trim().length > 0) onConfirm(value);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, value, required, multiline, onConfirm, onCancel]);

  if (!open) return null;

  const puedeConfirmar = !required || value.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {message && <p className="mt-1 text-sm text-slate-600">{message}</p>}

        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={3}
            autoFocus
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {cancelLabel}
          </button>
          <button type="button" onClick={() => onConfirm(value)} disabled={!puedeConfirmar}
            className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F9EA2] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
