"use client";

import { useState } from "react";
import { FileText, Receipt, Loader2, ExternalLink } from "lucide-react";

/**
 * Los comprobantes de un movimiento de caja, para abrirlos desde el reporte.
 *
 * ── POR QUÉ HACÍA FALTA ───────────────────────────────────────────────────
 * La factura y el recibo del egreso se podían subir desde Caja, y la hoja
 * impresa del arqueo decía si el egreso tenía respaldo o no. Pero ninguna
 * pantalla los ABRÍA: el endpoint que firma el enlace existía y nadie lo
 * llamaba. En la práctica el archivo entraba y no se podía volver a ver, que
 * es lo mismo que no haberlo subido.
 *
 * ── POR QUÉ EL ENLACE SE PIDE AL HACER CLIC Y NO SE GUARDA ────────────────
 * Los enlaces del storage vencen. Si se firmaran al cargar la pantalla, el que
 * deja el reporte abierto media hora se encuentra con un enlace roto y sin
 * forma de saber por qué. Pidiéndolo en el momento, siempre está fresco.
 *
 * El `path` no se arma acá: viene del movimiento, y el servidor comprueba que
 * pertenezca a la empresa del que pide antes de firmar nada.
 */

type Adjunto = { tipo: string; nombre: string; path?: string | null };

const ETIQUETA: Record<string, string> = { factura: "Factura", recibo: "Recibo" };

export default function ComprobantesMovimiento({
  adjuntos,
  /** Los egresos sin comprobante se marcan; en un ingreso no falta nada. */
  marcarFalta = false,
}: {
  adjuntos: Adjunto[] | null | undefined;
  marcarFalta?: boolean;
}) {
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lista = (adjuntos ?? []).filter((a) => (a.path ?? "").trim() !== "");

  if (lista.length === 0) {
    return marcarFalta
      ? <span className="text-[11px] text-amber-700">Sin comprobante</span>
      : <span className="text-[11px] text-slate-300">—</span>;
  }

  async function abrir(a: Adjunto) {
    const path = (a.path ?? "").trim();
    if (!path) return;
    setAbriendo(path);
    setError(null);
    try {
      const r = await fetch(`/api/caja/comprobante?path=${encodeURIComponent(path)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j?.success || !j?.data?.url) {
        throw new Error(j?.error ?? "No se pudo abrir el archivo.");
      }
      window.open(String(j.data.url), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el archivo.");
    } finally {
      setAbriendo(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {lista.map((a) => {
        const path = (a.path ?? "").trim();
        const esFactura = a.tipo === "factura";
        return (
          <button
            key={path}
            type="button"
            onClick={() => void abrir(a)}
            disabled={abriendo === path}
            title={a.nombre || ETIQUETA[a.tipo] || "Comprobante"}
            className={`inline-flex max-w-[12rem] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              esFactura
                ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {abriendo === path ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : esFactura ? (
              <FileText className="h-3 w-3 shrink-0" />
            ) : (
              <Receipt className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{ETIQUETA[a.tipo] ?? a.tipo}</span>
            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
          </button>
        );
      })}
      {error && <span className="text-[10px] leading-tight text-red-600">{error}</span>}
    </div>
  );
}
