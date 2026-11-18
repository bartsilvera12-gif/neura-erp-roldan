"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Vista previa de un PDF del sistema, en una ventana encima de la pantalla.
 *
 * Se trae con la sesión (los PDF piden estar logueado) y se muestra tal cual
 * va a salir impreso, sin descargarlo.
 */
export default function VistaPreviaPdf({
  url,
  titulo = "Vista previa",
  onClose,
}: {
  /** Ruta de la API que devuelve el PDF. */
  url: string;
  titulo?: string;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    void (async () => {
      try {
        const r = await fetchWithSupabaseSession(url, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "No se encontró el documento." : `No se pudo generar (${r.status}).`);
        const blob = await r.blob();
        if (!vivo) return;
        objeto = URL.createObjectURL(blob);
        setSrc(objeto);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo generar la vista previa.");
      }
    })();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => {
      vivo = false;
      window.removeEventListener("keydown", esc);
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [url, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="flex h-full max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <p className="text-sm font-semibold text-slate-800">{titulo}</p>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 bg-slate-100">
          {error ? (
            <p className="p-6 text-sm text-rose-700">{error}</p>
          ) : src ? (
            <iframe src={src} title={titulo} className="h-full w-full" />
          ) : (
            <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Armando el documento…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
