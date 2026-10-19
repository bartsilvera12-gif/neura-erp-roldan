"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import MesSelector from "@/components/reportes/MesSelector";
import { getGananciasReporte } from "@/lib/reportes/storage";
import type { TipoPeriodo } from "@/lib/reportes/periodos";
import {
  mesActualAsuncion,
  hoyAsuncionYmd,
  semanaLunesYmd,
  sumarDiasYmd,
  asuncionTrimestreDesdeHasta,
} from "@/lib/fechas/asuncion-bounds";
import type { GananciasReporte, GananciasPeriodo, Segmento } from "@/lib/reportes/ganancias-types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatPct(v: number) {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/** Variación % de `actual` respecto de `anterior`. null si no hay base previa. */
function deltaPct(actual: number, anterior: number): number | null {
  if (!anterior) return actual ? null : 0;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

/** Badge de variación. `mejorSiSube`: define el color (verde=bueno). */
function DeltaBadge({ actual, anterior, mejorSiSube = true }: { actual: number; anterior: number; mejorSiSube?: boolean }) {
  const d = deltaPct(actual, anterior);
  if (d === null) return <span className="text-slate-400">— nuevo</span>;
  const sube = d > 0.05;
  const baja = d < -0.05;
  const bueno = (sube && mejorSiSube) || (baja && !mejorSiSube);
  const malo = (sube && !mejorSiSube) || (baja && mejorSiSube);
  const color = bueno ? "text-emerald-600" : malo ? "text-red-600" : "text-slate-400";
  const flecha = sube ? "▲" : baja ? "▼" : "•";
  return (
    <span className={`tabular-nums font-medium ${color}`}>
      {flecha} {formatPct(Math.abs(d))}
    </span>
  );
}

const TIPOS: { key: TipoPeriodo; label: string }[] = [
  { key: "dia", label: "Día" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "trimestre", label: "Trimestre" },
  { key: "anio", label: "Año" },
  { key: "rango", label: "Rango" },
];

const PERIODO_NOMBRE: Record<TipoPeriodo, string> = {
  dia: "del día",
  semana: "de la semana",
  mes: "del mes",
  trimestre: "del trimestre",
  anio: "del año",
  rango: "del rango",
};

// Roldán e Hijos: segmentos Nutrición/Consignataria ocultos (herencia de Reserva).
// Se mantiene 'nutricion' como único segmento efectivo pero sin exponer el switch.
const SEGMENTOS: { key: Segmento; label: string }[] = [];

export default function GananciasReportePage() {
  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [segmento, setSegmento] = useState<Segmento>("nutricion");
  const hoy = useMemo(() => hoyAsuncionYmd(), []);
  const anioActual = Number(hoy.slice(0, 4));

  const [dia, setDia] = useState(hoy);
  const [semanaRef, setSemanaRef] = useState(() => semanaLunesYmd(hoy));
  const [mes, setMes] = useState(mesActualAsuncion());
  const [trimRef, setTrimRef] = useState(hoy);
  const [anio, setAnio] = useState(anioActual);
  const [rangoDesde, setRangoDesde] = useState(`${mesActualAsuncion()}-01`);
  const [rangoHasta, setRangoHasta] = useState(hoy);

  const [data, setData] = useState<GananciasReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const req =
      tipo === "dia" ? getGananciasReporte("dia", { ref: dia, segmento })
      : tipo === "semana" ? getGananciasReporte("semana", { ref: semanaRef, segmento })
      : tipo === "mes" ? getGananciasReporte("mes", { ref: mes, segmento })
      : tipo === "trimestre" ? getGananciasReporte("trimestre", { ref: trimRef, segmento })
      : tipo === "anio" ? getGananciasReporte("anio", { ref: String(anio), segmento })
      : getGananciasReporte("rango", { desde: rangoDesde, hasta: rangoHasta, segmento });
    req.then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [segmento, tipo, dia, semanaRef, mes, trimRef, anio, rangoDesde, rangoHasta]);

  // Límites "no ir al futuro" por tipo.
  const diaEsFuturo = dia >= hoy;
  const semanaEsFutura = semanaRef >= semanaLunesYmd(hoy);
  const trimEsFuturo = asuncionTrimestreDesdeHasta(sumarDiasYmd(asuncionTrimestreDesdeHasta(trimRef).hasta, 1)).desde > hoy;
  const anioEsFuturo = anio >= anioActual;

  const navBtn = "rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed";
  const navLabel = "min-w-[9rem] text-center text-sm font-medium text-slate-600";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Ganancias"
        description="Estado de resultados del período: ventas, costo, utilidad bruta, gastos y resultado neto"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Selector de segmento (unidad de negocio) */}
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {SEGMENTOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSegmento(s.key)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                    segmento === s.key ? "bg-[#3F8E91] text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Selector de granularidad */}
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

            {/* Navegador según el tipo */}
            {tipo === "mes" ? (
              <MesSelector mes={mes} onChange={setMes} />
            ) : tipo === "rango" ? (
              <div className="flex items-center gap-2">
                <input type="date" value={rangoDesde} max={rangoHasta}
                  onChange={(e) => setRangoDesde(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                <span className="text-slate-400 text-sm">a</span>
                <input type="date" value={rangoHasta} min={rangoDesde} max={hoy}
                  onChange={(e) => setRangoHasta(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
              </div>
            ) : tipo === "anio" ? (
              <div className="flex items-center gap-1">
                <button onClick={() => setAnio((y) => y - 1)} className={navBtn} aria-label="Año anterior"><ChevronLeft size={16} /></button>
                <span className={navLabel}>{anio}</span>
                <button onClick={() => setAnio((y) => y + 1)} disabled={anioEsFuturo} className={navBtn} aria-label="Año siguiente"><ChevronRight size={16} /></button>
              </div>
            ) : (
              // dia / semana / trimestre: ‹ label › con navegación
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (tipo === "dia") setDia((r) => sumarDiasYmd(r, -1));
                    else if (tipo === "semana") setSemanaRef((r) => sumarDiasYmd(r, -7));
                    else setTrimRef((r) => sumarDiasYmd(asuncionTrimestreDesdeHasta(r).desde, -1));
                  }}
                  className={navBtn} aria-label="Anterior"
                ><ChevronLeft size={16} /></button>
                <span className={navLabel}>{data?.periodoLabel ?? "…"}</span>
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
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el reporte de ganancias.
        </div>
      ) : (
        <ContenidoGanancias data={data} />
      )}
    </div>
  );
}

function ContenidoGanancias({ data }: { data: GananciasReporte }) {
  const a = data.actual;
  const p = data.anterior;
  const esConsig = data.segmento === "consignataria";
  const labVentas = esConsig ? "Comisión facturada" : "Ventas netas (sin IVA)";
  const labCosto = esConsig ? "Compras consignataria" : "Costo de lo vendido";

  return (
    <>
      <div className="text-sm text-slate-500">
        <span className="font-medium text-slate-700">{data.periodoLabel}</span>
        {"  ·  comparado contra "}
        <span className="font-medium text-slate-600">{data.anteriorLabel}</span>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          compact
          accent
          label={labVentas}
          value={formatGs(a.ventasNetas)}
          hint={esConsig
            ? <DeltaBadge actual={a.ventasNetas} anterior={p.ventasNetas} />
            : <>Con IVA: {formatGs(a.ventasTotales)} · <DeltaBadge actual={a.ventasNetas} anterior={p.ventasNetas} /></>}
        />
        <StatCard
          compact
          label={labCosto}
          value={formatGs(a.cmv)}
          hint={<>{esConsig ? "compras" : "CMV real"} · <DeltaBadge actual={a.cmv} anterior={p.cmv} mejorSiSube={false} /></>}
        />
        <StatCard
          compact
          label="Utilidad bruta"
          value={formatGs(a.gananciaBruta)}
          hint={<>Margen {formatPct(a.margenBruto)} · <DeltaBadge actual={a.gananciaBruta} anterior={p.gananciaBruta} /></>}
        />
        <StatCard
          compact
          label="Gastos operativos"
          value={formatGs(a.gastos)}
          hint={<>{PERIODO_NOMBRE[data.tipo]} · <DeltaBadge actual={a.gastos} anterior={p.gastos} mejorSiSube={false} /></>}
        />
        <StatCard
          compact
          accent
          label="Resultado neto"
          value={formatGs(a.gananciaNeta)}
          hint={<>Margen {formatPct(a.margenNeto)} · <DeltaBadge actual={a.gananciaNeta} anterior={p.gananciaNeta} /></>}
        />
        <StatCard
          compact
          label="Ventas realizadas"
          value={String(a.cantidadVentas)}
          hint={<>operaciones · <DeltaBadge actual={a.cantidadVentas} anterior={p.cantidadVentas} /></>}
        />
      </div>

      {/* Tabla comparativa detallada */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Detalle comparativo</h2>
          <p className="text-xs text-slate-400 mt-0.5">Período actual vs. período anterior</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2.5 px-6 font-medium">Concepto</th>
                <th className="py-2.5 px-4 font-medium text-right">{data.periodoLabel}</th>
                <th className="py-2.5 px-4 font-medium text-right">{data.anteriorLabel}</th>
                <th className="py-2.5 px-6 font-medium text-right">Variación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <Fila label={labVentas} actual={a.ventasNetas} anterior={p.ventasNetas} fmt={formatGs} />
              {!esConsig && (
                <Fila label="Ventas totales (con IVA)" actual={a.ventasTotales} anterior={p.ventasTotales} fmt={formatGs} tenue />
              )}
              <Fila label={esConsig ? "(−) Compras de consignataria" : "(−) Costo de la mercadería vendida"} actual={a.cmv} anterior={p.cmv} fmt={formatGs} mejorSiSube={false} />
              <Fila label="= Utilidad bruta" actual={a.gananciaBruta} anterior={p.gananciaBruta} fmt={formatGs} fuerte />
              <Fila label="Margen bruto %" actual={a.margenBruto} anterior={p.margenBruto} fmt={formatPct} sinGs />
              <Fila label="(−) Gastos operativos" actual={a.gastos} anterior={p.gastos} fmt={formatGs} mejorSiSube={false} />
              <Fila label="= Resultado operativo" actual={a.gananciaNeta} anterior={p.gananciaNeta} fmt={formatGs} fuerte />
              <Fila label="(±) Otros ingresos / gastos" actual={0} anterior={0} fmt={formatGs} tenue />
              <Fila label="= Resultado neto" actual={a.gananciaNeta} anterior={p.gananciaNeta} fmt={formatGs} fuerte />
              <Fila label="Margen neto %" actual={a.margenNeto} anterior={p.margenNeto} fmt={formatPct} sinGs />
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota metodológica */}
      <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
        El <strong>costo de la mercadería vendida (CMV)</strong> es el costo real de lo que se vendió en el período
        (no todas las compras), tomado del costo de cada producto al momento de la venta y expresado <strong>sin IVA</strong>{" "}
        (usando la tasa de cada producto), para que sea comparable con las ventas netas. Las ventas anuladas no se cuentan.
        Los márgenes se calculan sobre las ventas netas (sin IVA). Los <strong>gastos operativos</strong> provienen del módulo Gastos.
        {" "}<strong>Otros ingresos/gastos</strong> queda en 0 hasta que definamos qué partidas son no operativas (ej. intereses, extraordinarios);
        por ahora el resultado operativo y el neto coinciden.
      </p>
    </>
  );
}

function Fila({
  label,
  actual,
  anterior,
  fmt,
  mejorSiSube = true,
  sinGs = false,
  fuerte = false,
  tenue = false,
}: {
  label: string;
  actual: number;
  anterior: number;
  fmt: (v: number) => string;
  mejorSiSube?: boolean;
  sinGs?: boolean;
  fuerte?: boolean;
  tenue?: boolean;
}) {
  return (
    <tr className={fuerte ? "bg-slate-50/60" : ""}>
      <td className={`py-2.5 px-6 ${fuerte ? "font-semibold text-slate-800" : tenue ? "text-slate-400" : "text-slate-600"}`}>{label}</td>
      <td className={`py-2.5 px-4 text-right tabular-nums ${fuerte ? "font-semibold text-slate-900" : tenue ? "text-slate-400" : "text-slate-700"}`}>{fmt(actual)}</td>
      <td className="py-2.5 px-4 text-right tabular-nums text-slate-400">{fmt(anterior)}</td>
      <td className="py-2.5 px-6 text-right text-xs">
        {sinGs ? (
          <span className="tabular-nums text-slate-500">{(actual - anterior >= 0 ? "+" : "") + formatPct(actual - anterior).replace("%", " pp")}</span>
        ) : (
          <DeltaBadge actual={actual} anterior={anterior} mejorSiSube={mejorSiSube} />
        )}
      </td>
    </tr>
  );
}
