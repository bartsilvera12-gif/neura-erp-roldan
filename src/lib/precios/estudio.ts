import { margenSobreVenta, remarcacionSobreCosto, precioDesdeRemarcacion } from "@/lib/precios/margen";

/**
 * Estudio de precios (punto 10.5).
 *
 * "Modificar precios, margen, remarcación y comisiones por rubro, masivo y por
 * fila; mostrar costo de compra, cantidad de artículos y filtros."
 *
 * ── POR QUÉ LA CUENTA VIVE ACÁ Y NO EN LA PANTALLA ─────────────────────────
 *   Un cambio masivo de precios toca cientos de productos de una vez. El
 *   cálculo tiene que ser el mismo en la vista previa y al aplicar: si la
 *   pantalla calculara por su lado, bastaría una diferencia de redondeo para
 *   que lo que se aprueba y lo que se guarda no sean el mismo precio. Es una
 *   función pura, sin base de datos, y las dos puntas la llaman.
 *
 * ── LOS TRES MODOS, Y POR QUÉ NO ALCANZA CON UNO ──────────────────────────
 *   · remarcacion: "al costo ponele 60% encima". Es como se piensa un precio
 *     nuevo en el mostrador.
 *   · margen: "que me quede 35% de la venta". Es como se piensa cuando el
 *     objetivo viene de la rentabilidad, no del costo.
 *   · ajuste: "subí todo un 8%". Es como se piensa un aumento general, sin
 *     tocar la relación con el costo.
 *   Son tres preguntas distintas que la gente hace de verdad, y traducir una
 *   en otra a mano es justamente donde se equivocan (ver margen.ts).
 *
 * ── EL REDONDEO NO ES COSMÉTICO ───────────────────────────────────────────
 *   Un precio de 47.312 guaraníes obliga a buscar monedas que en una
 *   ferretería no hay. Redondear a 500 o a 1.000 es lo que hace que el precio
 *   sea cobrable. Se redondea SIEMPRE HACIA ARRIBA: hacia abajo se regala
 *   margen en cada venta, y sobre cientos de artículos eso se nota.
 */

export type ModoEstudio = "remarcacion" | "margen" | "ajuste";

export type ReglaPrecio = {
  modo: ModoEstudio;
  /** % de remarcación, % de margen objetivo, o % de ajuste (puede ser negativo). */
  valor: number;
  /** 0 = sin redondear. Típicos: 100, 500, 1000. */
  redondeo?: number;
};

export type ProductoPrecio = {
  id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio: number;
};

export type CambioPrecio = {
  id: string;
  nombre: string;
  sku: string;
  costo: number;
  precio_actual: number;
  precio_nuevo: number;
  diferencia: number;
  margen_actual: number;
  margen_nuevo: number;
  remarcacion_actual: number | null;
  remarcacion_nueva: number | null;
  /** Por qué no se puede tocar esta fila, si no se puede. */
  bloqueo: string | null;
};

/** Redondea hacia arriba al múltiplo pedido. */
export function redondearArriba(valor: number, multiplo: number): number {
  const m = Math.trunc(Number(multiplo) || 0);
  if (m <= 1) return Math.round(valor);
  return Math.ceil(valor / m) * m;
}

/**
 * Precio que resulta de aplicarle una regla a un producto.
 *
 * Devuelve `null` cuando la regla no se puede aplicar a ese producto; el
 * motivo lo arma `calcularCambio`, que es quien lo muestra.
 */
export function precioSegunRegla(p: ProductoPrecio, r: ReglaPrecio): number | null {
  const costo = Number(p.costo) || 0;
  const precio = Number(p.precio) || 0;
  const valor = Number(r.valor);
  if (!Number.isFinite(valor)) return null;

  let bruto: number;
  if (r.modo === "remarcacion") {
    // Sin costo no hay sobre qué remarcar.
    if (costo <= 0) return null;
    bruto = precioDesdeRemarcacion(costo, valor);
  } else if (r.modo === "margen") {
    if (costo <= 0) return null;
    // precio = costo / (1 − margen). Al 100% la cuenta se va al infinito: un
    // margen del 100% significaría que el costo es cero.
    if (valor >= 100) return null;
    bruto = costo / (1 - valor / 100);
  } else {
    // Ajuste sobre el precio actual: no necesita costo, pero sí un precio.
    if (precio <= 0) return null;
    bruto = precio * (1 + valor / 100);
  }

  if (!Number.isFinite(bruto) || bruto < 0) return null;
  return redondearArriba(bruto, r.redondeo ?? 0);
}

/** La fila completa: antes, después y por qué. */
export function calcularCambio(p: ProductoPrecio, r: ReglaPrecio): CambioPrecio {
  const costo = Number(p.costo) || 0;
  const precioActual = Number(p.precio) || 0;
  const nuevo = precioSegunRegla(p, r);

  let bloqueo: string | null = null;
  if (nuevo == null) {
    if ((r.modo === "remarcacion" || r.modo === "margen") && costo <= 0) {
      bloqueo = "Sin costo cargado";
    } else if (r.modo === "margen" && Number(r.valor) >= 100) {
      bloqueo = "Un margen del 100% no tiene precio posible";
    } else if (r.modo === "ajuste" && precioActual <= 0) {
      bloqueo = "Sin precio actual";
    } else {
      bloqueo = "No se puede calcular";
    }
  }

  const precioNuevo = nuevo ?? precioActual;
  return {
    id: p.id,
    nombre: p.nombre,
    sku: p.sku,
    costo,
    precio_actual: precioActual,
    precio_nuevo: precioNuevo,
    diferencia: precioNuevo - precioActual,
    margen_actual: margenSobreVenta(costo, precioActual),
    margen_nuevo: margenSobreVenta(costo, precioNuevo),
    remarcacion_actual: remarcacionSobreCosto(costo, precioActual),
    remarcacion_nueva: remarcacionSobreCosto(costo, precioNuevo),
    bloqueo,
  };
}

export type ResumenEstudio = {
  productos: number;
  /** Cuántos cambian de verdad (los que quedan igual no se escriben). */
  cambian: number;
  bloqueados: number;
  /** Cuántos pasarían a venderse por debajo del costo. */
  bajo_costo: number;
  margen_promedio_actual: number;
  margen_promedio_nuevo: number;
};

/**
 * El resumen de una tanda de cambios.
 *
 * El margen promedio se pondera por precio y no por cantidad de artículos: un
 * producto que se vende a 2.000 guaraníes no puede mover el promedio igual que
 * uno de 2.000.000. Sin ponderar, cambiar el precio de los tornillos parecería
 * mover la rentabilidad de la ferretería entera.
 */
export function resumirCambios(cambios: CambioPrecio[]): ResumenEstudio {
  const aplicables = cambios.filter((c) => !c.bloqueo);
  const sumaActual = aplicables.reduce((s, c) => s + c.precio_actual, 0);
  const sumaNueva = aplicables.reduce((s, c) => s + c.precio_nuevo, 0);
  const costoActual = aplicables.reduce((s, c) => s + c.costo, 0);

  return {
    productos: cambios.length,
    cambian: aplicables.filter((c) => c.precio_nuevo !== c.precio_actual).length,
    bloqueados: cambios.filter((c) => c.bloqueo).length,
    bajo_costo: aplicables.filter((c) => c.costo > 0 && c.precio_nuevo < c.costo).length,
    margen_promedio_actual: margenSobreVenta(costoActual, sumaActual),
    margen_promedio_nuevo: margenSobreVenta(costoActual, sumaNueva),
  };
}
