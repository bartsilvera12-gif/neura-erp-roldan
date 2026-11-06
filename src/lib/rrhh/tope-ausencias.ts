/**
 * El tope de ausencias: 3 cada 30 días, por persona.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "hasta 3 ausencias por usuario en el lapso de 30 días se debe tener y que
 *    cuando ya pase se avise en rojo."
 *
 * ── QUÉ CUENTA COMO UNA AUSENCIA ───────────────────────────────────────────
 *   Una ausencia es un HECHO, no un día: un reposo de tres días es una sola
 *   ausencia. Contar días diría que el que faltó una semana con certificado
 *   está peor que el que faltó tres lunes seguidos sin avisar, y es al revés:
 *   lo que se controla acá es cada cuánto falta, no cuánto dura.
 *
 *   Las VACACIONES no cuentan. Son un derecho, se piden y las aprueba la
 *   empresa, y van en su propio módulo. Si contaran, cualquiera que se tome
 *   sus días saldría en rojo, y el aviso dejaría de querer decir algo.
 *
 * ── LOS 30 DÍAS SON MÓVILES ────────────────────────────────────────────────
 *   No es "3 por mes". Es cualquier ventana de 30 días: el que falta el 28, el
 *   29, el 30 y el 2 del mes siguiente pasó el tope, aunque ningún mes del
 *   calendario tenga cuatro. Por eso cada ausencia se mira contra los 30 días
 *   que terminan en ella.
 *
 * ── EL ROJO SE PONE EN LA QUE SE PASA ──────────────────────────────────────
 *   No se pinta todo el bloque: se pinta la CUARTA. Las tres primeras están
 *   dentro de lo permitido, y marcarlas también haría que el rojo no diga
 *   cuál fue la que se pasó.
 */

export const TOPE_AUSENCIAS = 3;
export const VENTANA_DIAS = 30;

export interface AusenciaContable {
  id: string;
  empleado_id: string;
  /** Día en que empieza. Es el que decide en qué ventana cae. */
  fecha_desde: string;
  tipo: string;
}

/** Vacaciones no: son un derecho, no una ausencia a controlar. */
export function cuentaParaElTope(tipo: string): boolean {
  return String(tipo ?? "").trim().toLowerCase() !== "vacaciones";
}

const dia = (iso: string): number => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

/** `hasta` menos (VENTANA_DIAS − 1) días: la ventana incluye los dos extremos. */
export function inicioDeVentana(hastaISO: string, ventana = VENTANA_DIAS): string {
  const t = dia(hastaISO);
  if (!Number.isFinite(t)) return String(hastaISO).slice(0, 10);
  return new Date(t - (ventana - 1) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Cuántas ausencias tiene esa persona en los 30 días que terminan en `hasta`.
 *
 * Se mira `fecha_desde`: una ausencia pertenece al día en que empezó. Si se
 * mirara el rango entero, un reposo largo seguiría sumando semanas después, y
 * el tope dejaría de hablar de cada cuánto falta.
 */
export function contarEnVentana(
  ausencias: AusenciaContable[],
  empleadoId: string,
  hastaISO: string
): number {
  const desde = inicioDeVentana(hastaISO);
  const hasta = String(hastaISO).slice(0, 10);
  return ausencias.filter(
    (a) =>
      a.empleado_id === empleadoId &&
      cuentaParaElTope(a.tipo) &&
      a.fecha_desde.slice(0, 10) >= desde &&
      a.fecha_desde.slice(0, 10) <= hasta
  ).length;
}

export interface LugarEnLaVentana {
  /** Qué número de ausencia es dentro de su ventana de 30 días. 1, 2, 3, 4… */
  orden: number;
  /** Pasó el tope: es la cuarta o más. */
  pasada: boolean;
}

/**
 * Para cada ausencia, qué lugar ocupa en los 30 días que terminan en ella.
 *
 * Devuelve un mapa por `id`, para que la pantalla pinte en rojo justo la que
 * se pasó sin tener que recalcular nada por fila.
 */
export function lugarEnLaVentana(
  ausencias: AusenciaContable[]
): Map<string, LugarEnLaVentana> {
  const contables = ausencias.filter((a) => cuentaParaElTope(a.tipo));
  const m = new Map<string, LugarEnLaVentana>();
  for (const a of contables) {
    const orden = contarEnVentana(contables, a.empleado_id, a.fecha_desde.slice(0, 10));
    m.set(a.id, { orden, pasada: orden > TOPE_AUSENCIAS });
  }
  return m;
}

export interface EstadoDelTope {
  /** Ausencias en los últimos 30 días. */
  usadas: number;
  /** Cuántas le quedan antes de pasarse. Nunca negativo. */
  restantes: number;
  pasada: boolean;
}

/** Cómo está hoy esa persona: lo que se mira para decidir si se le avisa. */
export function estadoDelTope(
  ausencias: AusenciaContable[],
  empleadoId: string,
  hoyISO: string
): EstadoDelTope {
  const usadas = contarEnVentana(ausencias, empleadoId, hoyISO);
  return {
    usadas,
    restantes: Math.max(0, TOPE_AUSENCIAS - usadas),
    pasada: usadas > TOPE_AUSENCIAS,
  };
}

/**
 * Quiénes se pasaron del tope hoy, de mayor a menor.
 *
 * Es lo que se pone arriba de la pantalla: sin esto habría que abrir empleado
 * por empleado para enterarse.
 */
export function pasadosDelTope(
  ausencias: AusenciaContable[],
  hoyISO: string
): Array<{ empleado_id: string; usadas: number }> {
  const ids = Array.from(new Set(ausencias.filter((a) => cuentaParaElTope(a.tipo)).map((a) => a.empleado_id)));
  return ids
    .map((empleado_id) => ({ empleado_id, usadas: contarEnVentana(ausencias, empleado_id, hoyISO) }))
    .filter((e) => e.usadas > TOPE_AUSENCIAS)
    .sort((a, b) => b.usadas - a.usadas);
}

/**
 * La frase que se le muestra a quien está cargando una ausencia nueva.
 *
 * Se avisa ANTES de guardar, no después: el que la carga es el que puede ir a
 * preguntar qué pasó.
 */
export function textoDelTope(e: EstadoDelTope): string {
  if (e.pasada) {
    return `Pasó el tope: ${e.usadas} ausencias en los últimos ${VENTANA_DIAS} días (el máximo es ${TOPE_AUSENCIAS}).`;
  }
  if (e.usadas === TOPE_AUSENCIAS) {
    return `Llegó al tope: ${TOPE_AUSENCIAS} ausencias en los últimos ${VENTANA_DIAS} días. Una más y se pasa.`;
  }
  return `${e.usadas} ${e.usadas === 1 ? "ausencia" : "ausencias"} en los últimos ${VENTANA_DIAS} días · ${e.restantes} antes del tope.`;
}
