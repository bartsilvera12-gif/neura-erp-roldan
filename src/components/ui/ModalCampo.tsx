"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Modal para editar UN valor suelto.
 *
 * ── POR QUÉ NO ALCANZABA `window.prompt` ─────────────────────────────────
 *   El cuadro del navegador no se puede maquillar: aparece con los colores
 *   del sistema operativo, su propio tipo de letra y un título que dice
 *   "roldanehijos.neura.com.py dice". En medio de una pantalla cuidada se ve
 *   como un error, y encima deja el texto de ayuda apretado arriba del campo
 *   sin forma de darle jerarquía.
 *
 *   Tampoco deja validar sin cerrarlo: si el número está mal hay que avisar
 *   con OTRO cuadro, y el usuario tiene que volver a abrir y reescribir.
 *   Acá el error se muestra adentro y lo escrito no se pierde.
 *
 * ── SIGUE SIENDO UN MODAL Y NO UNA CELDA EDITABLE ────────────────────────
 *   Editar en la propia celda sería más directo, pero estos campos necesitan
 *   explicación —qué significan los días críticos, que el descuento del
 *   artículo manda sobre el del rubro— y esa explicación no entra en una
 *   celda de tabla.
 */
export default function ModalCampo({
  titulo,
  descripcion,
  etiqueta,
  valorInicial = "",
  sufijo,
  tipo = "text",
  placeholder,
  ayuda,
  textoGuardar = "Guardar",
  validar,
  onGuardar,
  onCerrar,
}: {
  titulo: string;
  /** Qué hace este campo. Va arriba del input, no adentro. */
  descripcion?: string;
  etiqueta: string;
  valorInicial?: string;
  /** "días", "%", lo que se muestra pegado al input. */
  sufijo?: string;
  tipo?: "text" | "number";
  placeholder?: string;
  /** Aclaración corta debajo del input. */
  ayuda?: string;
  textoGuardar?: string;
  /** Devuelve el mensaje de error, o null si está bien. */
  validar?: (v: string) => string | null;
  onGuardar: (v: string) => void | Promise<void>;
  onCerrar: () => void;
}) {
  const [valor, setValor] = useState(valorInicial);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // El foco va al campo y el texto queda seleccionado: lo normal es
  // reemplazar el valor, no agregarle algo al final.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Escape cierra, como en cualquier otro cuadro del sistema.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar, ocupado]);

  async function guardar() {
    const msg = validar?.(valor) ?? null;
    if (msg) { setError(msg); return; }
    setOcupado(true);
    setError(null);
    try {
      await onGuardar(valor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setOcupado(false);
    }
  }

  // ── Se dibuja colgado del <body> ───────────────────────────────────────
  //   `position: fixed` se mide contra el ancestro que tenga transform,
  //   filter o backdrop-filter, no contra la ventana. Este modal se abre
  //   desde cualquier lado —una celda de tabla, un popover del encabezado— y
  //   ahí adentro terminaba centrado respecto a un cuadrito de 300px, pegado
  //   arriba a la izquierda y por debajo de lo que lo abrió. Colgándolo del
  //   body el modal siempre es del tamaño de la pantalla.
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={ocupado ? undefined : onCerrar}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
            {descripcion && (
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{descripcion}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            className="ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {etiqueta}
          </label>
          <div className="relative mt-1.5">
            <input
              ref={ref}
              type={tipo}
              value={valor}
              placeholder={placeholder}
              disabled={ocupado}
              onChange={(e) => { setValor(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } }}
              className={`w-full rounded-lg border-2 px-3 py-2 text-sm outline-none ${sufijo ? "pr-12" : ""} ${
                error ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-[#4FAEB2]"
              }`}
            />
            {sufijo && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                {sufijo}
              </span>
            )}
          </div>
          {error ? (
            <p className="mt-1.5 text-xs text-red-700">{error}</p>
          ) : ayuda ? (
            <p className="mt-1.5 text-xs leading-snug text-slate-400">{ayuda}</p>
          ) : null}
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
            onClick={guardar}
            disabled={ocupado}
            className="rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {ocupado ? "Guardando…" : textoGuardar}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
