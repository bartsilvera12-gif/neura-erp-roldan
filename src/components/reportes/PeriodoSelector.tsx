"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MesSelector from "@/components/reportes/MesSelector";
import type { TipoPeriodo } from "@/lib/reportes/periodos";
import {
  mesActualAsuncion,
  hoyAsuncionYmd,
  semanaLunesYmd,
  sumarDiasYmd,
  diaLabel,
  rangoLabelCorto,
  asuncionTrimestreDesdeHasta,
  trimestreLabel,
} from "@/lib/fechas/asuncion-bounds";

export interface SeleccionPeriodo {
  tipo: TipoPeriodo;
  ref?: string;
  desde?: string;
  hasta?: string;
}

const TIPOS: { key: TipoPeriodo; label: string }[] = [
  { key: "dia", label: "Día" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "trimestre", label: "Trimestre" },
  { key: "anio", label: "Año" },
  { key: "rango", label: "Rango" },
];

/**
 * Selector de período reutilizable (día/semana/mes/trimestre/año/rango).
 * Emite la selección normalizada por `onChange` para pedir el reporte.
 */
export default function PeriodoSelector({ onChange }: { onChange: (sel: SeleccionPeriodo) => void }) {
  const hoy = useMemo(() => hoyAsuncionYmd(), []);
  const anioActual = Number(hoy.slice(0, 4));

  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [dia, setDia] = useState(hoy);
  const [semanaRef, setSemanaRef] = useState(() => semanaLunesYmd(hoy));
  const [mes, setMes] = useState(mesActualAsuncion());
  const [trimRef, setTrimRef] = useState(hoy);
  const [anio, setAnio] = useState(anioActual);
  const [rangoDesde, setRangoDesde] = useState(`${mesActualAsuncion()}-01`);
  const [rangoHasta, setRangoHasta] = useState(hoy);

  useEffect(() => {
    const sel: SeleccionPeriodo =
      tipo === "dia" ? { tipo, ref: dia }
      : tipo === "semana" ? { tipo, ref: semanaRef }
      : tipo === "mes" ? { tipo, ref: mes }
      : tipo === "trimestre" ? { tipo, ref: trimRef }
      : tipo === "anio" ? { tipo, ref: String(anio) }
      : { tipo, desde: rangoDesde, hasta: rangoHasta };
    onChange(sel);
    // onChange debe ser estable (useCallback) en el padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, dia, semanaRef, mes, trimRef, anio, rangoDesde, rangoHasta]);

  const diaEsFuturo = dia >= hoy;
  const semanaEsFutura = semanaRef >= semanaLunesYmd(hoy);
  const trimEsFuturo = asuncionTrimestreDesdeHasta(sumarDiasYmd(asuncionTrimestreDesdeHasta(trimRef).hasta, 1)).desde > hoy;
  const anioEsFuturo = anio >= anioActual;

  const navBtn = "rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed";
  const navLabel = "min-w-[9rem] text-center text-sm font-medium text-slate-600";

  const labelActual =
    tipo === "dia" ? diaLabel(dia)
    : tipo === "semana" ? rangoLabelCorto(semanaRef, sumarDiasYmd(semanaRef, 6))
    : tipo === "trimestre" ? (() => { const t = asuncionTrimestreDesdeHasta(trimRef); return trimestreLabel(t.anio, t.q); })()
    : "";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TIPOS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTipo(t.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
              tipo === t.key ? "bg-[#4FAEB2] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tipo === "mes" ? (
        <MesSelector mes={mes} onChange={setMes} />
      ) : tipo === "rango" ? (
        <div className="flex items-center gap-2">
          <input type="date" value={rangoDesde} max={rangoHasta} onChange={(e) => setRangoDesde(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <span className="text-slate-400 text-sm">a</span>
          <input type="date" value={rangoHasta} min={rangoDesde} max={hoy} onChange={(e) => setRangoHasta(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </div>
      ) : tipo === "anio" ? (
        <div className="flex items-center gap-1">
          <button onClick={() => setAnio((y) => y - 1)} className={navBtn} aria-label="Año anterior"><ChevronLeft size={16} /></button>
          <span className={navLabel}>{anio}</span>
          <button onClick={() => setAnio((y) => y + 1)} disabled={anioEsFuturo} className={navBtn} aria-label="Año siguiente"><ChevronRight size={16} /></button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (tipo === "dia") setDia((r) => sumarDiasYmd(r, -1));
              else if (tipo === "semana") setSemanaRef((r) => sumarDiasYmd(r, -7));
              else setTrimRef((r) => sumarDiasYmd(asuncionTrimestreDesdeHasta(r).desde, -1));
            }}
            className={navBtn} aria-label="Anterior"
          ><ChevronLeft size={16} /></button>
          <span className={navLabel}>{labelActual}</span>
          <button
            onClick={() => {
              if (tipo === "dia") setDia((r) => sumarDiasYmd(r, 1));
              else if (tipo === "semana") setSemanaRef((r) => sumarDiasYmd(r, 7));
              else setTrimRef((r) => sumarDiasYmd(asuncionTrimestreDesdeHasta(r).hasta, 1));
            }}
            disabled={tipo === "dia" ? diaEsFuturo : tipo === "semana" ? semanaEsFutura : trimEsFuturo}
            className={navBtn} aria-label="Siguiente"
          ><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}
