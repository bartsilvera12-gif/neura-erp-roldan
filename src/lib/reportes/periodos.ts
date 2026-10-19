/**
 * Resolvedor único de períodos para los reportes financieros.
 *
 * Dado un `tipo` (día/semana/mes/trimestre/año/rango) y los parámetros de la
 * request, devuelve el rango ACTUAL y el ANTERIOR (para comparación) expresados
 * como `desde`/`hasta` en `YYYY-MM-DD` (Asunción), más etiquetas legibles.
 *
 * Todos los reportes derivan sus límites timestamptz de estos `desde`/`hasta`
 * con `boundsDeRangoYmd`, así comparten exactamente la misma noción de período.
 */
import {
  hoyAsuncionYmd,
  semanaLunesYmd,
  sumarDiasYmd,
  diasEntreYmd,
  mesActualAsuncion,
  mesAnterior,
  ultimoDiaMes,
  mesLabelLargo,
  rangoLabelCorto,
  diaLabel,
  asuncionTrimestreDesdeHasta,
  asuncionAnioDesdeHasta,
  trimestreLabel,
} from "@/lib/fechas/asuncion-bounds";

export type TipoPeriodo = "dia" | "semana" | "mes" | "trimestre" | "anio" | "rango";

export interface RangoYmd {
  desde: string;
  hasta: string;
}

export interface PeriodoResuelto {
  tipo: TipoPeriodo;
  /** Referencia de navegación (para volver a pedir el mismo período). */
  ref: string;
  periodoLabel: string;
  anteriorLabel: string;
  actual: RangoYmd;
  anterior: RangoYmd;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;

function normalizarTipo(t: string | null): TipoPeriodo {
  return t === "dia" || t === "semana" || t === "mes" || t === "trimestre" || t === "anio" || t === "rango"
    ? t
    : "mes";
}

/** Rango inmediatamente anterior de la misma longitud (para día/semana/rango). */
function rangoAnteriorMismaLongitud(desde: string, hasta: string): RangoYmd {
  const largo = diasEntreYmd(desde, hasta); // 0 = un día
  const prevHasta = sumarDiasYmd(desde, -1);
  const prevDesde = sumarDiasYmd(prevHasta, -largo);
  return { desde: prevDesde, hasta: prevHasta };
}

export function resolverPeriodo(params: URLSearchParams): PeriodoResuelto {
  const tipo = normalizarTipo(params.get("tipo"));

  switch (tipo) {
    case "dia": {
      const p = params.get("fecha");
      const ref = p && YMD.test(p) ? p : hoyAsuncionYmd();
      const prev = sumarDiasYmd(ref, -1);
      return {
        tipo, ref,
        periodoLabel: diaLabel(ref),
        anteriorLabel: diaLabel(prev),
        actual: { desde: ref, hasta: ref },
        anterior: { desde: prev, hasta: prev },
      };
    }

    case "semana": {
      const p = params.get("semana");
      const base = p && YMD.test(p) ? p : hoyAsuncionYmd();
      const lunes = semanaLunesYmd(base);
      const domingo = sumarDiasYmd(lunes, 6);
      const lunesPrev = sumarDiasYmd(lunes, -7);
      const domingoPrev = sumarDiasYmd(lunes, -1);
      return {
        tipo, ref: lunes,
        periodoLabel: rangoLabelCorto(lunes, domingo),
        anteriorLabel: rangoLabelCorto(lunesPrev, domingoPrev),
        actual: { desde: lunes, hasta: domingo },
        anterior: { desde: lunesPrev, hasta: domingoPrev },
      };
    }

    case "trimestre": {
      const p = params.get("trimestre");
      const base = p && YMD.test(p) ? p : hoyAsuncionYmd();
      const t = asuncionTrimestreDesdeHasta(base);
      const tPrev = asuncionTrimestreDesdeHasta(sumarDiasYmd(t.desde, -1));
      return {
        tipo, ref: t.desde,
        periodoLabel: trimestreLabel(t.anio, t.q),
        anteriorLabel: trimestreLabel(tPrev.anio, tPrev.q),
        actual: { desde: t.desde, hasta: t.hasta },
        anterior: { desde: tPrev.desde, hasta: tPrev.hasta },
      };
    }

    case "anio": {
      const p = params.get("anio");
      const y = p && YEAR.test(p) ? Number(p) : Number(hoyAsuncionYmd().slice(0, 4));
      const a = asuncionAnioDesdeHasta(y);
      const aPrev = asuncionAnioDesdeHasta(y - 1);
      return {
        tipo, ref: String(y),
        periodoLabel: String(y),
        anteriorLabel: String(y - 1),
        actual: a,
        anterior: aPrev,
      };
    }

    case "rango": {
      const d = params.get("desde");
      const h = params.get("hasta");
      const hoy = hoyAsuncionYmd();
      let desde = d && YMD.test(d) ? d : `${mesActualAsuncion()}-01`;
      let hasta = h && YMD.test(h) ? h : hoy;
      if (hasta < desde) [desde, hasta] = [hasta, desde];
      const prev = rangoAnteriorMismaLongitud(desde, hasta);
      return {
        tipo, ref: `${desde}_${hasta}`,
        periodoLabel: rangoLabelCorto(desde, hasta),
        anteriorLabel: rangoLabelCorto(prev.desde, prev.hasta),
        actual: { desde, hasta },
        anterior: prev,
      };
    }

    case "mes":
    default: {
      const p = params.get("mes");
      const mes = p && YM.test(p) ? p : mesActualAsuncion();
      const prev = mesAnterior(mes);
      return {
        tipo: "mes", ref: mes,
        periodoLabel: mesLabelLargo(mes),
        anteriorLabel: mesLabelLargo(prev),
        actual: { desde: `${mes}-01`, hasta: ultimoDiaMes(mes) },
        anterior: { desde: `${prev}-01`, hasta: ultimoDiaMes(prev) },
      };
    }
  }
}
