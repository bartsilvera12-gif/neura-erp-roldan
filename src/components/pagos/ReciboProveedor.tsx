"use client";

import { useRef, useState } from "react";
import { Paperclip, FileCheck2, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

/**
 * El recibo del pago a una factura de proveedor.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "Cargar el recibo del pago a proveedor en la parte de pagos."
 *
 * ── POR QUÉ ES OTRO PAPEL Y NO EL MISMO ────────────────────────────────────
 *   La compra ya guarda la FACTURA del proveedor, que llega con la mercadería.
 *   El recibo es el que el proveedor firma cuando COBRA, y es el que alguien
 *   busca cuando pregunta si una factura se pagó de verdad. Son dos documentos
 *   de dos momentos distintos.
 *
 * ── SE PUEDE CARGAR AUNQUE LA FACTURA NO FIGURE PAGADA ─────────────────────
 *   No se bloquea: en la práctica el recibo aparece primero —lo trae el que
 *   fue a pagar— y recién después alguien marca la factura. Bloquearlo
 *   obligaría a inventar el orden inverso al que pasa en el mostrador.
 */
export default function ReciboProveedor({
  numeroControl, path, nombre, disponible, onCambio,
}: {
  numeroControl: string;
  /** Path en el storage, o null si todavía no hay recibo. */
  path: string | null;
  nombre: string | null;
  /** false = falta correr el script 68 y la base no tiene dónde guardarlo. */
  disponible: boolean;
  onCambio: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!disponible) {
    return (
      <span
        className="text-[11px] text-slate-300"
        title="Falta correr el script 68: la base todavía no tiene dónde guardar el recibo."
      >
        Recibo —
      </span>
    );
  }

  async function abrir() {
    if (!path) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/compras/recibo?path=${encodeURIComponent(path)}`);
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo abrir.");
      window.open(j.data.url as string, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el recibo.");
    } finally {
      setOcupado(false);
    }
  }

  async function subir(file: File) {
    setOcupado(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("numero_control", numeroControl);
      const r = await apiFetch("/api/compras/recibo", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el recibo.");
    } finally {
      setOcupado(false);
      if (input.current) input.current.value = "";
    }
  }

  async function quitar() {
    if (!window.confirm(`¿Quitar el recibo de ${numeroControl}? El archivo se borra.`)) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch(
        `/api/compras/recibo?numero_control=${encodeURIComponent(numeroControl)}`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo quitar.");
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el recibo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void subir(f);
        }}
      />

      {ocupado ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
      ) : path ? (
        <>
          <button
            type="button" onClick={() => void abrir()}
            className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-emerald-700 hover:underline"
            title={nombre ?? "Ver el recibo"}
          >
            <FileCheck2 className="h-3.5 w-3.5" /> Recibo
          </button>
          <button
            type="button" onClick={() => void quitar()}
            className="text-slate-300 hover:text-rose-600"
            title="Quitar el recibo"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      ) : (
        <button
          type="button" onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-slate-500 hover:text-[#4FAEB2] hover:underline"
          title="Subir el recibo del pago (PDF o foto)"
        >
          <Paperclip className="h-3.5 w-3.5" /> Recibo
        </button>
      )}

      {error && <span className="text-[10px] text-rose-600" title={error}>!</span>}
    </span>
  );
}
