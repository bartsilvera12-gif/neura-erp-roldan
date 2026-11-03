/**
 * Los tipos de vendedor habituales, como sugerencia al dar de alta uno nuevo.
 *
 * ── SON SUGERENCIAS, NO UNA LISTA CERRADA ─────────────────────────────────
 * En la reunión se pidió cerrarla ("tipos de vendedor predefinidos: call
 * center, vendedor externo, no escribir libre"), se cerró, y después se volvió
 * atrás a pedido: la casa necesita poder inventar un tipo sin esperar a que
 * alguien lo agregue al código. El campo acepta cualquier nombre y estos
 * aparecen como sugerencia.
 *
 * Lo que evita el desorden que motivaba el pedido es que el nombre se guarda en
 * MAYÚSCULAS (lo normaliza el endpoint): sin eso, "CALL CENTER", "Call center"
 * y "call center" entrarían como tres tipos distintos, cada uno con su
 * porcentaje y su mínimo, y las comisiones se repartirían entre tres
 * configuraciones que nadie quiso crear.
 *
 * `esTipoVendedorConocido` queda para poder distinguir en pantalla los
 * habituales de los inventados, si alguna vez hace falta.
 */
export const TIPOS_VENDEDOR: readonly string[] = [
  "CALL CENTER",
  "VENDEDOR EXTERNO",
  "MOSTRADOR",
  "SUPERVISOR DE VENTAS",
] as const;

/** Si un nombre es uno de los tipos previstos (sin mirar mayúsculas ni espacios). */
export function esTipoVendedorConocido(nombre: string | null | undefined): boolean {
  const n = String(nombre ?? "").trim().toUpperCase();
  if (n === "") return false;
  return TIPOS_VENDEDOR.some((t) => t.toUpperCase() === n);
}

/**
 * Los tipos que todavía se pueden crear: los de la lista que no estén ya
 * cargados. Ofrecer uno que ya existe solo lleva al error de nombre repetido.
 */
export function tiposDisponibles(yaCargados: Array<{ nombre: string }>): string[] {
  const usados = new Set(yaCargados.map((t) => String(t.nombre ?? "").trim().toUpperCase()));
  return TIPOS_VENDEDOR.filter((t) => !usados.has(t.toUpperCase()));
}
