"use client";

import { X } from "lucide-react";
import HistorialProducto from "@/components/inventario/HistorialProducto";

/**
 * Lo que movió la cantidad de un producto (la vista «General» del
 * historial), para mirarlo sin salir de un presupuesto o de la caja
 * (pedido del cliente). Solo lectura.
 */
export default function MovimientosProductoModal({
  productoId,
  nombre,
  onClose,
}: {
  productoId: string;
  nombre: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl overflow-hidden rounded-xl bg-slate-50 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{nombre}</h3>
            <p className="text-[11px] text-slate-500">Lo que entró y salió de este producto.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">
          <HistorialProducto productoId={productoId} soloGeneral />
        </div>
      </div>
    </div>
  );
}
