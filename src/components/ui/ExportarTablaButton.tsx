"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Botón "Excel" para cualquier listado (requisito general 11.1).
 *
 * Manda al servidor las filas que la pantalla ya tiene cargadas y filtradas,
 * y recibe la planilla. La planilla es, por construcción, exactamente lo que
 * se está viendo: mismas filas, mismas columnas, mismo orden.
 *
 * Es a propósito que no vuelva a consultar la base: un endpoint propio por
 * pantalla terminaría, tarde o temprano, diciendo algo distinto de lo que
 * muestra la tabla de al lado.
 *
 * Uso:
 *   <ExportarTablaButton
 *     titulo="Movimientos de inventario"
 *     archivo="movimientos"
 *     subtitulo="Del 01/10 al 31/10"
 *     columnas={["Fecha", "Producto", "Cantidad"]}
 *     filas={filtrados.map((m) => [fecha(m), m.producto_nombre, m.cantidad])}
 *   />
 */

export type CeldaExport = string | number | boolean | null | undefined;

export default function ExportarTablaButton({
  titulo,
  archivo,
  subtitulo,
  columnas,
  filas,
  label = "Excel",
  className = "",
}: {
  titulo: string;
  archivo: string;
  subtitulo?: string;
  columnas: string[];
  /** Una fila por renglón, en el mismo orden que `columnas`. */
  filas: CeldaExport[][];
  label?: string;
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    if (ocupado) return;
    if (filas.length === 0) {
      setError("No hay nada para exportar con estos filtros.");
      setTimeout(() => setError(null), 3000);
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/export/tabla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, archivo, subtitulo, columnas, filas }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(String(j?.error ?? `No se pudo exportar (${r.status}).`));
        setTimeout(() => setError(null), 4000);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dispo = r.headers.get("Content-Disposition") ?? "";
      a.download = /filename="([^"]+)"/.exec(dispo)?.[1] ?? `${archivo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo exportar.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={descargar}
        disabled={ocupado}
        className={
          className ||
          "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/5 disabled:opacity-50"
        }
      >
        {ocupado ? "Generando…" : label}
      </button>
      {error && <span className="mt-1 text-[11px] text-amber-600">{error}</span>}
    </span>
  );
}
