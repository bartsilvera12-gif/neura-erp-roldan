/**
 * De dónde salen los fondos con los que abre un mes del flujo de caja.
 *
 * ── EL PROBLEMA QUE ARREGLA ────────────────────────────────────────────────
 * Antes, un mes sin fondos cargados a mano arrancaba en CERO. Como la fila
 * Disponible solo baja, el mes entero salía en rojo desde el primer pago, y el
 * número que mostraba —"te faltan 100.000"— no era cierto: era "no sé cuánta
 * plata tenés". Octubre 2026 tenía fondos cargados y noviembre no, así que al
 * pasar de mes la pantalla pasaba de un saldo sano a todo negativo sin que
 * hubiera cambiado nada en el negocio.
 *
 * La regla la fijó el cliente para la caja chica: "si hay sobrante, la caja del
 * siguiente día se abre con más la caja". Es el mismo principio y acá vale
 * igual: un mes abre con lo que quedó del anterior.
 *
 * ── EL ORDEN DE PRIORIDAD ──────────────────────────────────────────────────
 *   1. `saldos`    — la posición de liquidez del mes (bancos + efectivo).
 *                    Es una foto real: si está cargada, manda.
 *   2. `manual`    — el monto escrito a mano en la config del mes.
 *   3. `arrastre`  — el Disponible con que cerró el mes anterior.
 *   4. `sin_datos` — no hay de dónde sacarlo. Cero, pero dicho con todas las
 *                    letras, para que la pantalla pueda avisar en vez de
 *                    mostrar un rojo que parece una deuda.
 *
 * El arrastre encadena: si el mes anterior tampoco tenía fondos propios, se
 * sigue hacia atrás hasta el último mes que sí los tenga, y se le aplican los
 * netos de todos los meses del medio.
 *
 * ── LO QUE EL ARRASTRE NO ES ───────────────────────────────────────────────
 * Es una PROYECCIÓN, no un extracto bancario. El neto de un mes pasado se
 * calcula con los pagos y las cobranzas que estaban proyectados, no con lo que
 * de verdad entró y salió del banco. Si un cheque se pagó tarde o un cliente no
 * pagó, el arrastre no se entera. Por eso la posición de liquidez tiene más
 * prioridad: cargarla es la forma de volver a poner la pantalla en hora.
 */

/** Plata que entró y salió en un mes, en guaraníes. */
export interface NetoDelMes {
  ingresos: number;
  egresos: number;
}

export type OrigenFondos = "saldos" | "manual" | "arrastre" | "sin_datos";

export interface FondosDelMes {
  fondos: number;
  origen: OrigenFondos;
  /** Si vino arrastrado, de qué mes salió el último monto cargado a mano. */
  arrastre_de?: { anio: number; mes: number };
  /** Cuántos meses se recorrieron hacia atrás. 0 si los fondos son propios. */
  meses_arrastrados: number;
}

/** Un mes como número corrido, para poder restarlos y compararlos. */
export const indiceMes = (anio: number, mes: number): number => anio * 12 + (mes - 1);

/** De vuelta a año y mes. */
export function desdeIndice(indice: number): { anio: number; mes: number } {
  return { anio: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

export interface EntradaArrastre {
  /**
   * El monto propio del mes, si lo tiene: la posición de liquidez o el monto
   * manual. `null` = ese mes no tiene fondos propios y hay que seguir atrás.
   */
  propios: number | null;
  /** `saldos` o `manual`, según de dónde salió `propios`. */
  origenPropios?: "saldos" | "manual";
  /** Lo proyectado para ese mes. Se usa solo para encadenar el arrastre. */
  neto: NetoDelMes;
}

/**
 * Los fondos con que abre el mes pedido.
 *
 * `mesesAtras` acota la búsqueda: sin tope, un sistema recién cargado se
 * pondría a mirar meses vacíos hasta el año 2000.
 */
export function fondosConArrastre(
  anio: number,
  mes: number,
  datos: (anio: number, mes: number) => EntradaArrastre,
  mesesAtras = 12
): FondosDelMes {
  const objetivo = indiceMes(anio, mes);

  // Lo propio gana siempre: es un dato cargado, no una deducción.
  const propio = datos(anio, mes);
  if (propio.propios != null) {
    return {
      fondos: propio.propios,
      origen: propio.origenPropios ?? "manual",
      meses_arrastrados: 0,
    };
  }

  // Hacia atrás, hasta el último mes con un monto propio.
  for (let atras = 1; atras <= mesesAtras; atras++) {
    const i = objetivo - atras;
    const { anio: a, mes: m } = desdeIndice(i);
    const ancla = datos(a, m);
    if (ancla.propios == null) continue;

    // Encontrada: se arranca de ahí y se aplican los netos de ese mes y de
    // todos los del medio, hasta el mes anterior al pedido.
    let saldo = ancla.propios;
    for (let j = i; j < objetivo; j++) {
      const { anio: aj, mes: mj } = desdeIndice(j);
      const n = datos(aj, mj).neto;
      saldo += n.ingresos - n.egresos;
    }
    return {
      fondos: saldo,
      origen: "arrastre",
      arrastre_de: { anio: a, mes: m },
      meses_arrastrados: atras,
    };
  }

  return { fondos: 0, origen: "sin_datos", meses_arrastrados: 0 };
}
