/**
 * Cómo se escribe y cómo se convierte la plata.
 *
 * ── LAS DOS MONEDAS NO SE ESCRIBEN IGUAL ───────────────────────────────────
 *   "en dolares debe ser con decimales… con dos espacios despues de la coma
 *    lo de los dolares."
 *
 *   El guaraní no tiene centavos: Gs. 1.500.000, entero. El dólar sí, y
 *   escribirlo sin decimales no es redondear de más, es perder plata a la
 *   vista: US$ 15,65 mostrado como "US$ 16" es casi un 2% de diferencia, y en
 *   una factura de miles de unidades eso se nota.
 *
 * ── AL PASAR A GUARANÍES SE REDONDEA HACIA ARRIBA ──────────────────────────
 *   "que redondee hacia arriba si hay algun calculo que pase de dolares a
 *    guaranies."
 *
 *   Porque el resultado no tiene decimales y hay que decidir qué se hace con
 *   ellos. Hacia arriba, y no al más cercano, porque es lo que no deja una
 *   deuda de un guaraní dando vueltas: si se paga lo que se debe redondeado
 *   para abajo, siempre falta. El que pone el guaraní de más es la casa, que
 *   es quien puede.
 *
 * ── TODO ESTO ESTABA ESCRITO 141 VECES ─────────────────────────────────────
 *   Había un `const gs = …` copiado en cada pantalla —veinticinco veces con
 *   la misma firma, otras diez con otra—, y ninguno sabía de dólares. Por eso
 *   una pantalla podía mostrar guaraníes con el cartel de dólares sin que
 *   nada lo impidiera.
 */

export type Moneda = "PYG" | "USD";

/** Normaliza lo que venga de la base: "usd", "Usd", null… */
export function aMoneda(v: unknown): Moneda {
  return String(v ?? "PYG").trim().toUpperCase() === "USD" ? "USD" : "PYG";
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * El monto escrito como se lee en Paraguay.
 *
 *   formatearMoneda(1500000)          → "Gs. 1.500.000"
 *   formatearMoneda(15.65, "USD")     → "US$ 15,65"
 *   formatearMoneda(15.6, "USD")      → "US$ 15,60"   (dos decimales siempre)
 *
 * Los guaraníes se redondean al entero: la moneda no tiene centavos y
 * mostrarlos hace creer que el sistema maneja una precisión que no existe.
 */
export function formatearMoneda(monto: unknown, moneda: unknown = "PYG"): string {
  const m = aMoneda(moneda);
  const n = num(monto);
  if (m === "USD") {
    return `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

/** Sin el prefijo, para las columnas de una tabla que ya dice la moneda. */
export function formatearMonto(monto: unknown, moneda: unknown = "PYG"): string {
  const m = aMoneda(moneda);
  const n = num(monto);
  if (m === "USD") {
    return n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(n).toLocaleString("es-PY");
}

/**
 * De dólares a guaraníes, redondeando HACIA ARRIBA.
 *
 * Devuelve 0 si el tipo de cambio no sirve: sin cotización no se puede
 * convertir, y devolver el monto en dólares como si fueran guaraníes sería
 * mostrar un número 7.000 veces más chico sin avisar.
 */
export function aGuaranies(montoUsd: unknown, tipoCambio: unknown): number {
  const tc = num(tipoCambio);
  if (tc <= 0) return 0;
  return Math.ceil(num(montoUsd) * tc);
}

/**
 * De guaraníes a dólares, con dos decimales.
 *
 * Acá NO se redondea hacia arriba: el dólar tiene centavos, así que se
 * redondea al centavo más cercano, que es lo que hace cualquier calculadora.
 */
export function aDolares(montoGs: unknown, tipoCambio: unknown): number {
  const tc = num(tipoCambio);
  if (tc <= 0) return 0;
  return Math.round((num(montoGs) / tc) * 100) / 100;
}

/**
 * Un precio en dólares que no puede serlo.
 *
 * En la base hay compras marcadas en USD donde el "precio en dólares" es en
 * realidad el precio en guaraníes: de 1.000 compras en USD, 323 tienen el
 * mismo número en los dos campos. Un artículo de ferretería no cuesta
 * US$ 68.198, así que un monto así marcado como dólares es un dato mal
 * migrado, no una compra cara.
 *
 * Sirve para avisar en pantalla en vez de mostrar el número como si nada.
 */
export function pareceGuaraniesEnDolares(montoUsd: unknown, tipoCambio: unknown): boolean {
  const n = num(montoUsd);
  const tc = num(tipoCambio);
  if (n <= 0 || tc <= 0) return false;
  // Un precio unitario de más de diez mil dólares en este rubro no existe.
  return n > 10_000;
}
