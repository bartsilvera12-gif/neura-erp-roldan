"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Confirmación de una acción que no se puede deshacer.
 *
 * Reemplaza a `window.confirm`, que sale con el título
 * "roldanehijos.neura.com.py dice" y los colores del sistema operativo. En
 * una acción destructiva eso importa más que en el resto: el cuadro del
 * navegador se parece tanto a los avisos que uno descarta todo el día que se
 * acepta de memoria.
 *
 * Acá el botón peligroso está en rojo, dice qué hace —"Borrar" y no "Aceptar"—
 * y el que cancela es el que queda a mano.
 */
export default function ModalConfirmarAccion({
  titulo,
  detalle,
  textoConfirmar = "Borrar",
  onConfirmar,
  onCerrar,
}: {
  titulo: string;
  detalle?: string;
  textoConfirmar?: string;
  onConfirmar: () => void | Promise<void>;
  onCerrar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar, ocupado]);

  async function confirmar() {
    setOcupado(true);
    setError(null);
    try {
      await onConfirmar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.");
      setOcupado(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={ocupado ? undefined : onCerrar}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
            {detalle && <p className="mt-1 text-xs leading-snug text-slate-500">{detalle}</p>}
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={ocupado}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {ocupado ? "Borrando…" : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
