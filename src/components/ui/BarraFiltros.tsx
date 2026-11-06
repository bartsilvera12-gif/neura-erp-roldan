"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * La fila de filtros de una pantalla de listado.
 *
 * ── QUÉ ESTABA MAL ─────────────────────────────────────────────────────────
 *   Los filtros y los botones de exportar colgaban sueltos abajo del título,
 *   todos del mismo peso: cuatro botones —Excel, Imprimir, Excel cobros,
 *   Imprimir cobros— al lado de los campos, compitiendo con ellos. Para
 *   filtrar había que leer la fila entera y descartar lo que no era un campo.
 *
 *   Acá los campos van juntos en una superficie, y lo que se hace CON el
 *   resultado —exportar, imprimir— va del otro lado y más tenue. Y cuando hay
 *   algún filtro puesto aparece "Limpiar", que es lo que no se encuentra
 *   cuando la lista salió vacía y no se sabe por qué.
 */

export function CampoFiltro({
  etiqueta, children, className = "",
}: {
  etiqueta: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-medium text-slate-500">{etiqueta}</span>
      {children}
    </label>
  );
}

export default function BarraFiltros({
  children, acciones, hayFiltro = false, onLimpiar,
}: {
  /** Los campos, cada uno dentro de un <CampoFiltro>. */
  children: ReactNode;
  /** Exportar, imprimir: lo que se hace con el resultado, no para armarlo. */
  acciones?: ReactNode;
  hayFiltro?: boolean;
  onLimpiar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        {children}
        {hayFiltro && onLimpiar && (
          <button
            type="button" onClick={onLimpiar}
            className="inline-flex h-[38px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>
      {acciones && (
        <div className="flex flex-wrap items-center gap-2">{acciones}</div>
      )}
    </div>
  );
}

/** El alto y el borde que comparten todos los campos de la barra. */
export const campoClase =
  "h-[38px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
