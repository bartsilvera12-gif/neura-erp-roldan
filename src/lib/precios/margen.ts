import { sinIva, ivaIncluido } from "@/lib/precios/iva";

/**
 * Margen y remarcación (punto 1.7).
 *
 * ── EL IVA NO ES GANANCIA ─────────────────────────────────────────────────
 * Los precios de venta y los costos se guardan CON IVA INCLUIDO. Restarlos
 * así nomás da una ganancia inflada, porque adentro de esa resta quedó la
 * diferencia entre el IVA que se le cobra al cliente y el IVA que se pagó al
 * proveedor: plata que es del fisco y que la empresa solo está pasando de una
 * mano a la otra.
 *
 *   Venta 85.566 (10%) − Costo 74.276 (10%) = 11.290  ← lo que se mostraba
 *   IVA de la venta 7.779 − IVA del costo 6.752 = 1.027
 *   Ganancia real = 11.290 − 1.027 = 10.264
 *
 * Por eso toda función de acá acepta las dos tasas —la de la línea de venta y
 * la del artículo— y cuando se las pasa, trabaja con los importes sin IVA.
 *
 * CUANDO LAS DOS TASAS SON IGUALES EL PORCENTAJE NO CAMBIA
 *   Dividir arriba y abajo por el mismo 1,1 se cancela: el margen de un
 *   artículo al 10% comprado al 10% sigue dando el mismo %. Lo que cambia es
 *   la GANANCIA EN GUARANÍES, que ahora es la de verdad. Las tasas distintas
 *   —vender exento algo comprado al 10%— son las que mueven el porcentaje, y
 *   son justo los casos en los que el número viejo mentía más.
 *
 * SIN TASAS SE COMPORTA COMO ANTES
 *   Los parámetros de IVA son opcionales. Quien no los pasa obtiene la cuenta
 *   vieja sobre importes con IVA. No es que esté bien: es que hay pantallas
 *   que todavía no tienen la tasa a mano y es mejor que sigan mostrando lo de
 *   siempre que un número a medio corregir.
 *
 * SON DOS NÚMEROS DISTINTOS Y SE CONFUNDEN TODO EL TIEMPO
 *
 *   Costo 100.000, precio 150.000:
 *     remarcación = 50.000 / 100.000 = 50%   ← cuánto se le puso ENCIMA AL COSTO
 *     margen      = 50.000 / 150.000 = 33,3% ← qué parte DE LA VENTA es ganancia
 *
 *   Es la misma plata mirada desde dos lados. Confundirlas es caro en las dos
 *   direcciones: pedir "40% de ganancia" pensando en remarcación y aplicarlo
 *   como margen deja un precio más alto del acordado; al revés, deja uno más
 *   bajo y se vende perdiendo sin que nadie lo note.
 *
 *   Por eso en pantalla van las dos, con su nombre, y nunca una sola rotulada
 *   de forma ambigua.
 *
 * LOS TRES NÚMEROS Y EN QUÉ ORDEN SALEN
 *   1. UTILIDAD BRUTA (en guaraníes) = venta − costo − diferencia de IVA.
 *   2. MARGEN BRUTO (%) = utilidad bruta / venta.
 *   3. REMARCACIÓN (%) = utilidad bruta / costo.
 *   Primero la plata, después los dos porcentajes como su cociente. Los dos
 *   salen de la misma función para que no puedan contradecirse.
 *
 * CUÁL SE USA PARA QUÉ
 *   Para FIJAR un precio se piensa en remarcación: "al costo le pongo 60%".
 *   Para medir RENTABILIDAD se usa el margen: es la parte de la facturación
 *   que queda. El punto 4.4 (comisión según rentabilidad) necesita el margen.
 */

/**
 * Los dos importes sin IVA, listos para restarse.
 *
 * `ivaVenta` manda también para el costo cuando `ivaCosto` no viene: lo normal
 * es que el artículo se compre y se venda con la misma tasa, y pedir las dos
 * siempre obligaría a todas las pantallas a cargar el artículo completo.
 */
function netos(
  costo: number,
  precio: number,
  ivaVenta?: string,
  ivaCosto?: string
): { costo: number; precio: number } {
  const c = Number(costo) || 0;
  const p = Number(precio) || 0;
  if (!ivaVenta) return { costo: c, precio: p };
  return { costo: sinIva(c, ivaCosto ?? ivaVenta), precio: sinIva(p, ivaVenta) };
}

/**
 * MARGEN BRUTO: qué parte de la venta queda como utilidad bruta.
 *
 *   margen bruto = utilidad bruta / venta × 100
 *
 * Sale de la utilidad bruta y no de una resta propia, a propósito: son el
 * mismo número mirado de dos formas, y calculados por separado un día uno se
 * corrige y el otro no.
 */
export function margenBruto(
  costo: number,
  precio: number,
  ivaVenta?: string,
  ivaCosto?: string
): number {
  const n = netos(costo, precio, ivaVenta, ivaCosto);
  if (n.precio <= 0) return 0;
  return (utilidadBruta(costo, precio, ivaVenta, ivaCosto) / n.precio) * 100;
}

/** Nombre viejo de `margenBruto`. Se mantiene por los que ya lo importan. */
export const margenSobreVenta = margenBruto;

/**
 * Cuánto se le puso encima al costo: (precio − costo) / costo × 100.
 *
 * Sin costo cargado no existe: devuelve null en vez de cero, porque "0% de
 * remarcación" significa que se vende al costo, y eso es una afirmación
 * distinta de "no sabemos cuánto costó".
 */
export function remarcacionSobreCosto(
  costo: number,
  precio: number,
  ivaVenta?: string,
  ivaCosto?: string
): number | null {
  const n = netos(costo, precio, ivaVenta, ivaCosto);
  if (n.costo <= 0) return null;
  return (utilidadBruta(costo, precio, ivaVenta, ivaCosto) / n.costo) * 100;
}

/** Precio que resulta de aplicarle una remarcación al costo. */
export function precioDesdeRemarcacion(costo: number, remarcacionPct: number): number {
  return (Number(costo) || 0) * (1 + (Number(remarcacionPct) || 0) / 100);
}

/**
 * UTILIDAD BRUTA en guaraníes.
 *
 *   utilidad bruta = (precio de venta − precio de costo)
 *                    − (IVA de la venta − IVA del costo)
 *
 * Las dos puntas en guaraníes y con IVA, que es como están guardadas. Es lo
 * mismo que restar los dos importes ya sin IVA, y así está escrito acá:
 * una resta en vez de cuatro, pero es la misma cuenta.
 *
 * De este número sale el margen bruto. Es el orden que importa: primero la
 * utilidad en plata, y el porcentaje después, como su cociente.
 */
export function utilidadBruta(
  costo: number,
  precio: number,
  ivaVenta?: string,
  ivaCosto?: string
): number {
  const n = netos(costo, precio, ivaVenta, ivaCosto);
  return n.precio - n.costo;
}

/** Nombre viejo de `utilidadBruta`. Se mantiene por los que ya lo importan. */
export const gananciaUnitaria = utilidadBruta;

/**
 * El IVA que hay que sacar de la resta, por separado.
 *
 * Existe para poder MOSTRARLO: cuando alguien que venía leyendo "ganancia
 * 11.290" ve "10.263", lo primero que pregunta es de dónde salió la
 * diferencia, y la respuesta tiene que estar en la misma pantalla.
 */
export function diferenciaDeIva(
  costo: number,
  precio: number,
  ivaVenta: string,
  ivaCosto?: string
): number {
  return ivaIncluido(Number(precio) || 0, ivaVenta)
       - ivaIncluido(Number(costo) || 0, ivaCosto ?? ivaVenta);
}

/**
 * Color según el margen. Los cortes son los que ya usaba Inventario, para no
 * cambiarle el significado a algo que la gente viene leyendo.
 *
 * El negativo se separa: no es "margen bajo", es venta a pérdida.
 */
export function colorMargen(margen: number): string {
  if (margen < 0) return "text-rose-600";
  if (margen >= 40) return "text-green-600";
  if (margen >= 20) return "text-yellow-600";
  return "text-red-600";
}

/** Formatea un porcentaje, o "—" cuando no se puede calcular. */
export function pct(valor: number | null, decimales = 1): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  return `${valor.toFixed(decimales)}%`;
}
