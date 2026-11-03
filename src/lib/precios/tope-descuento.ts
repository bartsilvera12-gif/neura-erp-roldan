/**
 * El descuento cargado en el artículo o en el rubro es un TOPE, no un precio.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ───────────────────────────────────────────────
 *   "El porcentaje es el descuento permitido, pero no quiere decir que todos
 *    deben tener ese tipo de descuento: si pongo descuento quiere decir que
 *    hasta cierto descuento tiene, no que tiene 4% de descuento."
 *
 *   Antes, un rubro cargado con 4% salía con el 4% ya aplicado en cada venta:
 *   el vendedor no regalaba nada, el sistema lo regalaba solo. Cuatro por
 *   ciento sobre todo lo que se vende de ese rubro, todos los días, sin que
 *   nadie lo haya decidido venta por venta.
 *
 *   Ahora el precio que sale es el de lista, y ese 4% es hasta cuánto se
 *   puede bajar si el cliente lo pide y el vendedor lo decide.
 *
 * ── DOS TOPES A LA VEZ ────────────────────────────────────────────────────
 *   Ya existía un tope por persona (punto 2.3: `usuarios.descuento_maximo_pct`).
 *   Ese sigue valiendo y ahora conviven: el de la persona dice cuánto puede
 *   regalar ESA persona, el del artículo cuánto aguanta ESE artículo. Tienen
 *   que cumplirse los dos, así que el tope de la línea es el más chico de los
 *   que existan.
 *
 *   Que no haya tope cargado no es un tope de cero. Un artículo en 0 nunca
 *   significó "sin descuento" en este sistema —significa "no tengo el mío"— y
 *   si se lo leyera como cero, al día siguiente de este cambio no se podría
 *   descontar nada en ningún artículo, que es lo contrario de lo pedido.
 */

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export interface TopeDeLista {
  /** Hasta cuánto se puede descontar. null = este artículo no tiene tope propio. */
  pct: number | null;
  origen: "articulo" | "rubro" | "ninguno";
}

/**
 * El tope que le corresponde a un artículo: el suyo si tiene, y si no el de
 * su rubro.
 *
 * El del artículo REEMPLAZA al del rubro, no se suma: sumarlos haría que un
 * artículo con 5% propio dentro de un rubro al 4% permita 9%, que no es lo
 * que nadie quiso decir al cargar los dos.
 */
export function topeDeLista(
  descuentoArticulo: string | number | null | undefined,
  descuentoRubro: string | number | null | undefined
): TopeDeLista {
  const a = num(descuentoArticulo) ?? 0;
  if (a > 0) return { pct: a, origen: "articulo" };
  const r = num(descuentoRubro) ?? 0;
  if (r > 0) return { pct: r, origen: "rubro" };
  return { pct: null, origen: "ninguno" };
}

/**
 * El tope de una línea: el más chico de los que existan.
 *
 * `null` en los dos = sin tope (el comportamiento de siempre para quien no
 * tiene configurado ninguno). Un cero SÍ es un tope de cero: "este usuario no
 * puede aplicar descuentos" es una decisión tomada y se respeta.
 */
export function topeAplicable(
  topeUsuario: number | null | undefined,
  topeArticulo: number | null | undefined
): number | null {
  const u = topeUsuario ?? null;
  const a = topeArticulo ?? null;
  if (u === null) return a;
  if (a === null) return u;
  return Math.min(u, a);
}

/** De dónde sale el tope de la línea, para poder decirlo en pantalla. */
export function textoTope(
  topeUsuario: number | null | undefined,
  lista: TopeDeLista
): string {
  const t = topeAplicable(topeUsuario, lista.pct);
  if (t === null) return "Sin tope de descuento.";
  if (t === 0) return "No se pueden aplicar descuentos en esta línea.";
  const porArticulo = lista.pct !== null && t === lista.pct && (topeUsuario ?? Infinity) >= lista.pct;
  if (porArticulo) {
    return lista.origen === "articulo"
      ? `Hasta ${t}% de descuento: es el tope de este artículo.`
      : `Hasta ${t}% de descuento: es el tope del rubro.`;
  }
  return `Hasta ${t}% de descuento: es tu tope.`;
}
