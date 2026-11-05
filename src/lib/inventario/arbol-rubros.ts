/**
 * El árbol de rubros: quién cuelga de quién.
 *
 * ── PARA QUÉ ───────────────────────────────────────────────────────────────
 *   Al poder editar el rubro entero —y no solo su nombre— se puede cambiar de
 *   quién cuelga. Y ahí aparece un agujero: si a un rubro se le pone como
 *   padre a uno de sus propios hijos, el árbol queda en círculo.
 *
 *   Un rubro en círculo no se "ve mal": DESAPARECE. La pantalla arma la lista
 *   recorriendo desde los que no tienen padre, y un círculo no cuelga de
 *   ninguno, así que esos rubros dejan de aparecer con todos sus productos
 *   adentro. Nadie lo relaciona con haber cambiado un combo tres días antes.
 *
 *   Por eso el combo de padre no ofrece a los descendientes, y el servidor
 *   igual lo vuelve a chequear: la pantalla se puede saltear.
 */

/** Lo mínimo para saber quién cuelga de quién. */
export interface RamaRubro {
  id: string;
  parent_id: string | null;
}

/** Una rama con nombre, que es lo que se muestra. */
export interface RubroNodo extends RamaRubro {
  nombre: string;
}

/**
 * Todos los que cuelgan de `id`, directa o indirectamente.
 *
 * Aguanta que los datos ya vengan en círculo —no entra en loop infinito—
 * porque esto también se usa para detectar el problema, no solo para evitarlo.
 */
export function descendientes(items: RamaRubro[], id: string): Set<string> {
  const hijosDe = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parent_id) continue;
    const l = hijosDe.get(it.parent_id) ?? [];
    l.push(it.id);
    hijosDe.set(it.parent_id, l);
  }
  const salida = new Set<string>();
  const pila = [...(hijosDe.get(id) ?? [])];
  while (pila.length > 0) {
    const actual = pila.pop()!;
    if (salida.has(actual) || actual === id) continue;
    salida.add(actual);
    pila.push(...(hijosDe.get(actual) ?? []));
  }
  return salida;
}

/**
 * ¿`candidato` puede ser el padre de `id`?
 *
 * No puede si es él mismo ni si cuelga de él. `null` —sin padre— siempre vale.
 */
export function puedeSerPadre(
  items: RamaRubro[],
  id: string,
  candidato: string | null
): boolean {
  if (candidato == null || candidato === "") return true;
  if (candidato === id) return false;
  if (!items.some((i) => i.id === candidato)) return false;
  return !descendientes(items, id).has(candidato);
}

/** Los rubros que se le pueden ofrecer como padre, ordenados por nombre. */
export function padresPosibles(items: RubroNodo[], id: string): RubroNodo[] {
  const noVan = descendientes(items, id);
  return items
    .filter((i) => i.id !== id && !noVan.has(i.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** "HIERROS › PERFILES › ANGULOS", para mostrar dónde está parado el rubro. */
export function rutaDeRubro(items: RubroNodo[], id: string, sep = " › "): string {
  const porId = new Map(items.map((i) => [i.id, i]));
  const partes: string[] = [];
  const vistos = new Set<string>();
  let actual = porId.get(id);
  while (actual && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    partes.unshift(actual.nombre);
    actual = actual.parent_id ? porId.get(actual.parent_id) : undefined;
  }
  return partes.join(sep);
}
