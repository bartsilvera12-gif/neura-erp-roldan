/**
 * Los tipos de vendedor que se pueden dar de alta.
 *
 * ── POR QUÉ UNA LISTA Y NO TEXTO LIBRE ────────────────────────────────────
 * Se pidió en la reunión: "tipos de vendedor predefinidos: call center,
 * vendedor externo (no escribir libre)". Con el campo abierto aparecen
 * "CALL CENTER", "Call center" y "CALLCENTER" como tres tipos distintos, cada
 * uno con su porcentaje y su mínimo, y las comisiones se reparten entre tres
 * configuraciones que nadie quiso crear.
 *
 * Asignarle un tipo a una persona ya era un desplegable; lo que faltaba era
 * cerrar la creación.
 *
 * ── LOS TIPOS QUE YA EXISTEN NO SE TOCAN ──────────────────────────────────
 * Si en la base hay un tipo con otro nombre, sigue funcionando: esta lista
 * limita lo que se puede CREAR, no lo que existe. Borrar un tipo cargado
 * dejaría sin porcentaje a los vendedores que lo tienen asignado.
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
