/**
 * El descuento de una línea de presupuesto, en porcentaje y en guaraníes.
 *
 * ── EL PROBLEMA ───────────────────────────────────────────────────────────
 * El vendedor piensa el descuento de dos maneras distintas, y las dos son
 * legítimas:
 *
 *   «le hago el 10%»          → un porcentaje
 *   «le dejo en 850.000»      → un precio más bajo que el de lista
 *
 * La pantalla guardaba solo un monto en guaraníes. Poner "10%" había que
 * calcularlo a mano, y bajar el precio unitario no quedaba registrado como
 * descuento en ningún lado: el total bajaba y nadie podía decir cuánto se
 * resignó ni por qué.
 *
 * ── CÓMO SE RESUELVE ──────────────────────────────────────────────────────
 * El monto en guaraníes sigue siendo lo que se guarda y lo que se resta del
 * total: es la única cifra que no depende de redondeos. El porcentaje viaja
 * al lado para que la pantalla pueda mostrarlo sin recalcularlo con error.
 *
 *   - Se escribe el %  → se calcula el monto.
 *   - Se escribe el monto → se calcula el %.
 *   - Cambia la cantidad o el precio → si el descuento se pactó en %, el
 *     monto se recalcula para que el % se mantenga. Si se pactó un monto
 *     fijo, el monto queda como está: 50.000 de descuento son 50.000,
 *     lleve dos unidades o veinte.
 *
 * El precio rebajado NO se convierte en monto de descuento: el total ya lo
 * refleja: contarlo dos veces regalaría el doble. Se calcula aparte
 * (`descuentoPorPrecio`) para poder mostrarlo.
 */

/** Lo mínimo que necesita una línea para calcular su descuento. */
export type LineaDescuento = {
  cantidad: number;
  precio_unitario: number;
  /** En guaraníes. Es lo que se resta del total. */
  descuento: number;
  /** El % equivalente, para mostrarlo sin recalcularlo con error. */
  descuento_pct: number;
  /**
   * Cómo lo pactó el vendedor. Decide qué pasa al cambiar la cantidad o el
   * precio: un 10% sigue siendo 10% de lo que valga la línea, un descuento de
   * 50.000 sigue siendo 50.000.
   *
   * Sin este dato no se pueden distinguir: escribir 30.000 sobre un bruto de
   * 200.000 deja un 15% derivado, y al subir la cantidad el monto se
   * multiplicaría solo, sin que nadie lo haya pedido.
   */
  descuento_modo: "monto" | "pct";
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Redondeo a dos decimales, para porcentajes. */
function r2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Lo que vale la línea antes de descuento. */
export function brutoLinea(l: Pick<LineaDescuento, "cantidad" | "precio_unitario">): number {
  return n(l.precio_unitario) * n(l.cantidad);
}

/**
 * Aplica un cambio a la línea dejando el % y el monto coherentes entre sí.
 *
 * Devuelve la línea nueva; no modifica la que recibe.
 */
export function aplicarCambio<T extends LineaDescuento>(
  linea: T,
  cambio: Partial<T>
): T {
  const sig = { ...linea, ...cambio } as T;
  const bruto = brutoLinea(sig);

  // Guaraníes: el monto nunca puede pasarse del bruto (un descuento mayor al
  // precio sería regalar la mercadería y poner plata encima) ni ser negativo.
  const tope = (m: number) => Math.min(Math.max(0, Math.round(m)), Math.max(0, Math.round(bruto)));

  if ("descuento_pct" in cambio) {
    const pct = Math.min(Math.max(0, n(cambio.descuento_pct)), 100);
    sig.descuento_pct = r2(pct);
    sig.descuento = tope((bruto * pct) / 100);
    sig.descuento_modo = "pct";
    return sig;
  }

  if ("descuento" in cambio) {
    const monto = tope(n(cambio.descuento));
    sig.descuento = monto;
    sig.descuento_pct = bruto > 0 ? r2((monto / bruto) * 100) : 0;
    sig.descuento_modo = "monto";
    return sig;
  }

  // Cambió la cantidad o el precio: lo que manda es cómo se pactó.
  if ("cantidad" in cambio || "precio_unitario" in cambio) {
    if (sig.descuento_modo === "pct") {
      sig.descuento = tope((bruto * n(sig.descuento_pct)) / 100);
    } else {
      // Monto fijo: solo se recorta si el bruto bajó por debajo de él.
      sig.descuento = tope(n(sig.descuento));
      sig.descuento_pct = bruto > 0 ? r2((n(sig.descuento) / bruto) * 100) : 0;
    }
  }

  return sig;
}

/**
 * El descuento que quedó implícito al escribir un precio más bajo que el de
 * lista. Solo informativo: ya está dentro del total.
 *
 * Devuelve null cuando no hay rebaja que mostrar: sin precio de lista (una
 * línea escrita a mano no tiene con qué comparar), o con un precio igual o
 * mayor al de lista (recargar no es descontar).
 */
export function descuentoPorPrecio(
  precioLista: number,
  precioUnitario: number,
  cantidad: number
): { monto: number; pct: number } | null {
  const lista = n(precioLista);
  const cobrado = n(precioUnitario);
  if (lista <= 0 || cobrado >= lista) return null;
  const pct = r2(((lista - cobrado) / lista) * 100);
  const monto = Math.round((lista - cobrado) * n(cantidad));
  if (monto <= 0) return null;
  return { monto, pct };
}

/**
 * Todo lo que se resignó en la línea: lo del precio rebajado más el descuento
 * cargado aparte. Es la cifra que contesta «¿cuánto le hice?».
 */
export function descuentoTotalLinea(
  linea: LineaDescuento & { precio_lista?: number }
): { monto: number; pct: number } {
  const porPrecio = descuentoPorPrecio(
    n(linea.precio_lista),
    n(linea.precio_unitario),
    n(linea.cantidad)
  );
  const monto = (porPrecio?.monto ?? 0) + Math.max(0, Math.round(n(linea.descuento)));
  // El % se mide contra lo que la línea habría valido a precio de lista: si no
  // hay precio de lista, contra el bruto cobrado.
  const base = n(linea.precio_lista) > 0
    ? n(linea.precio_lista) * n(linea.cantidad)
    : brutoLinea(linea);
  return { monto, pct: base > 0 ? r2((monto / base) * 100) : 0 };
}
