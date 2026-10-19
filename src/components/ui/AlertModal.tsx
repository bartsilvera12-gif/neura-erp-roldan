"use client";

import { useEffect } from "react";

export type AlertTone = "info" | "success" | "warning" | "error";

/**
 * Modal informativo del ERP. Reemplaza al `window.alert` nativo.
 * Cerrar por Esc, Enter o click afuera → onClose.
 */
export default function AlertModal({
  open,
  title,
  message,
  tone = "info",
  onClose,
  label = "OK",
}: {
  open: boolean;
  title: string;
  message?: string;
  tone?: AlertTone;
  onClose: () => void;
  label?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const toneMap = {
    info:    { icon: "bg-[#E5F4F4] text-[#3F8E91]", btn: "bg-[#4FAEB2] hover:bg-[#3F9EA2] text-white" },
    success: { icon: "bg-emerald-50 text-emerald-700", btn: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    warning: { icon: "bg-amber-50 text-amber-700",     btn: "bg-amber-600 hover:bg-amber-700 text-white" },
    error:   { icon: "bg-rose-50 text-rose-600",       btn: "bg-rose-600 hover:bg-rose-700 text-white" },
  }[tone];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${toneMap.icon} mb-3`}>
          <span className="text-xl">
            {tone === "success" ? "✓" : tone === "error" ? "✕" : tone === "warning" ? "!" : "i"}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {message && <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{message}</p>}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${toneMap.btn}`}>
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
