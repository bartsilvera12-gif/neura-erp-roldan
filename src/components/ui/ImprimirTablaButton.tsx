"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { CeldaExport } from "@/components/ui/ExportarTablaButton";

/**
 * Botón "Imprimir" para cualquier listado (requisito general 11.1).
 *
 * Gemelo del de Excel: manda al servidor las mismas filas que la pantalla
 * tiene cargadas y filtradas, y abre la hoja A4 lista para imprimir.
 *
 * ── POR QUÉ SE ABRE LA VENTANA ANTES DE PEDIR LA HOJA ────────────────────
 *   El navegador solo deja abrir una pestaña durante el clic. Si se pidiera
 *   primero la hoja y se abriera después, al volver la respuesta el clic ya
 *   terminó y el bloqueador de ventanas la cancela sin decir nada. Por eso se
 *   abre vacía al instante, se escribe "Generando…" y recién ahí se pide.
 */
export default function ImprimirTablaButton({
  titulo,
  subtitulo,
  columnas,
  filas,
  sumar,
  label = "Imprimir",
  className = "",
}: {
  titulo: string;
  subtitulo?: string;
  columnas: string[];
  filas: CeldaExport[][];
  /** Índices de columna que se totalizan al pie. */
  sumar?: number[];
  label?: string;
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function imprimir() {
    if (ocupado) return;
    if (filas.length === 0) {
      setError("No hay nada para imprimir con estos filtros.");
      setTimeout(() => setError(null), 3000);
      return;
    }
    const ventana = window.open("", "_blank");
    if (ventana) {
      ventana.document.write(
        '<p style="font:14px Arial;padding:24px;color:#555">Generando la hoja…</p>'
      );
    }
    setOcupado(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/imprimir/tabla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, subtitulo, columnas, filas, sumar }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        ventana?.close();
        setError(String(j?.error ?? `No se pudo imprimir (${r.status}).`));
        setTimeout(() => setError(null), 4000);
        return;
      }
      const html = await r.text();
      if (!ventana) {
        // Con el bloqueador de ventanas activo no hay dónde mostrarla. Se
        // avisa en vez de no hacer nada, que es lo que pasaba si no.
        setError("Permití las ventanas emergentes para poder imprimir.");
        setTimeout(() => setError(null), 5000);
        return;
      }
      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
    } catch {
      setError("No se pudo generar la hoja.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={imprimir}
        disabled={ocupado}
        className={
          className ||
          "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        }
      >
        {ocupado ? "Generando…" : label}
      </button>
      {error && <span className="mt-1 text-[11px] text-amber-600">{error}</span>}
    </span>
  );
}
