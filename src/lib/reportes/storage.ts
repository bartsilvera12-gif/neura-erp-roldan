import type { EstadoCuentaReporte, ProveedoresReporte, ComprasReporte, VentasReporte, ConciliacionReporte } from "./types";
import type { GananciasReporte, Segmento } from "./ganancias-types";
import type { TipoPeriodo } from "./periodos";
import type { RentabilidadReporte, AgruparRentabilidad } from "./rentabilidad-types";
import type { FlujoCajaReporte } from "./flujo-caja-types";
import type { TesoreriaReporte } from "./tesoreria-types";

/** Arma los params de período comunes (día/semana/mes/trimestre/año/rango). */
function periodoParams(
  tipo: TipoPeriodo,
  opts?: { ref?: string; desde?: string; hasta?: string }
): URLSearchParams {
  const p = new URLSearchParams({ tipo });
  if (tipo === "dia" && opts?.ref) p.set("fecha", opts.ref);
  else if (tipo === "semana" && opts?.ref) p.set("semana", opts.ref);
  else if (tipo === "mes" && opts?.ref) p.set("mes", opts.ref);
  else if (tipo === "trimestre" && opts?.ref) p.set("trimestre", opts.ref);
  else if (tipo === "anio" && opts?.ref) p.set("anio", opts.ref);
  else if (tipo === "rango") {
    if (opts?.desde) p.set("desde", opts.desde);
    if (opts?.hasta) p.set("hasta", opts.hasta);
  }
  return p;
}

/**
 * Los mismos parámetros, pero como string, para armar los links de exportar e
 * imprimir (requisito 11.1).
 *
 * Tiene que ser el mismo armado que usa la pantalla: si el link de la planilla
 * construyera el período por su cuenta, un día la planilla y la pantalla
 * mostrarían meses distintos y nadie sabría cuál creer.
 */
export function queryPeriodo(
  tipo: TipoPeriodo,
  opts?: { ref?: string; desde?: string; hasta?: string }
): string {
  return periodoParams(tipo, opts).toString();
}

async function getReporte<T>(url: string): Promise<T | null> {
  try {
    // fetchWithSupabaseSession añade el Authorization header con el token de
    // Supabase — necesario en Coolify donde la sesión no viaja sólo por cookie.
    // Con `fetch` raw, /api/reportes/* respondía 401 y el UI mostraba
    // "No se pudo cargar el <reporte>." sin más pista.
    const { fetchWithSupabaseSession } = await import("@/lib/api/fetch-with-supabase-session");
    const r = await fetchWithSupabaseSession(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return null;
    return j.data as T;
  } catch (e) {
    console.error("[reportes] getReporte:", e);
    return null;
  }
}

const mq = (mes: string) => encodeURIComponent(mes);

export const getEstadoCuentaReporte = (mes: string) =>
  getReporte<EstadoCuentaReporte>(`/api/reportes/estado-cuenta?mes=${mq(mes)}`);
export const getProveedoresReporte = (mes: string) =>
  getReporte<ProveedoresReporte>(`/api/reportes/proveedores?mes=${mq(mes)}`);
export const getComprasReporte = (mes: string) =>
  getReporte<ComprasReporte>(`/api/reportes/compras?mes=${mq(mes)}`);
export const getVentasReporte = (mes: string) =>
  getReporte<VentasReporte>(`/api/reportes/ventas?mes=${mq(mes)}`);
export const getConciliacionReporte = (mes: string) =>
  getReporte<ConciliacionReporte>(`/api/reportes/conciliacion?mes=${mq(mes)}`);
export const getGananciasReporte = (
  tipo: TipoPeriodo,
  opts?: { ref?: string; desde?: string; hasta?: string; segmento?: Segmento }
) => {
  const p = periodoParams(tipo, opts);
  if (opts?.segmento) p.set("segmento", opts.segmento);
  return getReporte<GananciasReporte>(`/api/reportes/ganancias?${p.toString()}`);
};

export const getRentabilidadReporte = (
  tipo: TipoPeriodo,
  agrupar: AgruparRentabilidad,
  opts?: { ref?: string; desde?: string; hasta?: string }
) => {
  const p = periodoParams(tipo, opts);
  p.set("agrupar", agrupar);
  return getReporte<RentabilidadReporte>(`/api/reportes/rentabilidad?${p.toString()}`);
};

export const getFlujoCajaReporte = (
  tipo: TipoPeriodo,
  opts?: { ref?: string; desde?: string; hasta?: string }
) => getReporte<FlujoCajaReporte>(`/api/reportes/flujo-caja?${periodoParams(tipo, opts).toString()}`);

export const getTesoreriaReporte = (
  tipo: TipoPeriodo,
  opts?: { ref?: string; desde?: string; hasta?: string }
) => getReporte<TesoreriaReporte>(`/api/reportes/tesoreria?${periodoParams(tipo, opts).toString()}`);
