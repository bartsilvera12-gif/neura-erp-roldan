/**
 * Cálculo de comisiones (puntos 4.4 y 4.5).
 *
 * Sin base de datos a propósito: la cuenta se puede probar con casos armados a
 * mano, que es lo único que da confianza cuando de esto sale lo que cobra cada
 * vendedor a fin de mes.
 *
 * ── POR QUÉ SOBRE LA GANANCIA Y NO SOBRE LA FACTURACIÓN ────────────────────
 *   El pedido (4.4) dice "calcular comisiones proporcionalmente a la
 *   remarcación o margen. Si hay descuento que reduce la rentabilidad, ajustar
 *   también la comisión".
 *
 *       comisión = porcentaje × (venta sin IVA − costo)
 *
 *   Así el ajuste por descuento sale solo, sin ninguna regla aparte: bajar el
 *   precio baja la ganancia, y la comisión baja con ella. Un porcentaje sobre
 *   la facturación haría lo contrario — premiaría vender barato, porque la
 *   facturación con descuento entra igual.
 *
 * ── SIN IVA, LOS DOS LADOS ─────────────────────────────────────────────────
 *   El precio de venta y el costo guardado incluyen IVA. La ganancia se
 *   calcula sacándoselo a ambos: el IVA no es del negocio, es del Estado, y
 *   comisionar sobre él sería pagar por plata que hay que entregar.
 *
 * ── UNA VENTA A PÉRDIDA NO GENERA COMISIÓN NEGATIVA ────────────────────────
 *   Si la ganancia da negativa, la comisión es cero, no un número en contra.
 *   Descontarle plata a un vendedor por una venta mal hecha es una decisión de
 *   la empresa, no algo que el sistema deba hacer solo. La pérdida igual queda
 *   a la vista en el informe.
 */

export type BaseCalculo = "margen" | "facturacion";

/** Una regla de `comisiones_reglas`. NULL en un campo = "cualquiera". */
export interface ReglaComision {
  tipo_vendedor_id: string | null;
  categoria_id: string | null;
  porcentaje: number;
  activo?: boolean;
}

export interface LineaVentaComision {
  /** Rubro del producto. null si no tiene. */
  categoria_id: string | null;
  cantidad: number;
  /** Precio unitario cobrado, con IVA. */
  precio_venta: number;
  /** Precio de lista unitario, con IVA. Sirve para medir el descuento. */
  precio_venta_original: number;
  /** Costo unitario del producto, con IVA. */
  costo_unitario: number;
  tipo_iva: "EXENTA" | "5%" | "10%" | string;
}

export interface ResultadoLinea {
  facturado: number;
  /** Lo que se dejó de cobrar respecto del precio de lista. */
  descuento: number;
  costo: number;
  ganancia: number;
  porcentaje: number;
  comision: number;
}

/** Divisor para sacar el IVA de un precio que lo incluye. */
export function divisorIva(tipoIva: string): number {
  if (tipoIva === "10%") return 1.1;
  if (tipoIva === "5%") return 1.05;
  return 1;
}

/** Quita el IVA de un importe que lo incluye. */
export function sinIva(montoConIva: number, tipoIva: string): number {
  return (Number(montoConIva) || 0) / divisorIva(tipoIva);
}

/**
 * Porcentaje que corresponde, de la regla más específica a la más general.
 *
 * El orden importa y es el del pedido: una regla para "externo + hierros" tiene
 * que ganarle a "hierros" y a "externo", porque es la que alguien escribió
 * pensando justo en ese caso.
 */
export function porcentajeAplicable(
  reglas: ReglaComision[],
  tipoVendedorId: string | null,
  categoriaId: string | null,
  porcentajeBaseDelTipo: number,
  /**
   * Porcentaje cargado en la ficha de la persona. Le gana a todo lo demás.
   *
   * Es el acuerdo particular con un vendedor —el que entró con otro trato, el
   * socio que cobra distinto— y por eso pisa hasta la regla por rubro: si la
   * regla pudiera ganarle, el acuerdo no sería un acuerdo.
   *
   * `null` es "no tiene uno propio", que no es lo mismo que cero. Cero es un
   * valor real: la persona que no comisiona.
   */
  porcentajePropio: number | null = null
): number {
  if (porcentajePropio != null) return porcentajePropio;

  const activas = reglas.filter((r) => r.activo !== false);
  const buscar = (t: string | null, c: string | null) =>
    activas.find((r) => r.tipo_vendedor_id === t && r.categoria_id === c);

  if (tipoVendedorId && categoriaId) {
    const exacta = buscar(tipoVendedorId, categoriaId);
    if (exacta) return exacta.porcentaje;
  }
  if (categoriaId) {
    const porRubro = buscar(null, categoriaId);
    if (porRubro) return porRubro.porcentaje;
  }
  if (tipoVendedorId) {
    const porTipo = buscar(tipoVendedorId, null);
    if (porTipo) return porTipo.porcentaje;
  }
  const general = buscar(null, null);
  if (general) return general.porcentaje;

  return Number(porcentajeBaseDelTipo) || 0;
}

/** Comisión de una línea de venta. */
export function comisionDeLinea(
  linea: LineaVentaComision,
  reglas: ReglaComision[],
  tipoVendedorId: string | null,
  porcentajeBaseDelTipo: number,
  base: BaseCalculo = "margen",
  /** Porcentaje propio del vendedor; le gana a las reglas. */
  porcentajePropio: number | null = null
): ResultadoLinea {
  const cantidad = Number(linea.cantidad) || 0;
  const iva = linea.tipo_iva;

  const facturado = sinIva(Number(linea.precio_venta) || 0, iva) * cantidad;
  const lista = sinIva(Number(linea.precio_venta_original) || 0, iva) * cantidad;
  // El costo guardado también viene con IVA incluido: se le saca con el mismo
  // criterio para que los dos lados de la resta estén en la misma moneda.
  const costo = sinIva(Number(linea.costo_unitario) || 0, iva) * cantidad;

  // Un precio por encima del de lista no es un descuento negativo, es un
  // recargo: no se resta de nada.
  const descuento = Math.max(0, lista - facturado);
  const ganancia = facturado - costo;

  const porcentaje = porcentajeAplicable(
    reglas,
    tipoVendedorId,
    linea.categoria_id,
    porcentajeBaseDelTipo,
    porcentajePropio
  );

  const sobre = base === "facturacion" ? facturado : ganancia;
  // Ver el comentario de arriba: a pérdida no se comisiona en contra.
  const comision = sobre > 0 ? (sobre * porcentaje) / 100 : 0;

  return { facturado, descuento, costo, ganancia, porcentaje, comision };
}

export interface ResultadoVenta extends Omit<ResultadoLinea, "porcentaje"> {
  /** Porcentaje efectivo de toda la venta: comisión / base. Puede no coincidir
   *  con ninguna regla si la venta mezcla rubros con porcentajes distintos. */
  porcentaje_efectivo: number;
}

/** Suma las líneas de una venta. */
export function comisionDeVenta(
  lineas: LineaVentaComision[],
  reglas: ReglaComision[],
  tipoVendedorId: string | null,
  porcentajeBaseDelTipo: number,
  base: BaseCalculo = "margen"
): ResultadoVenta {
  let facturado = 0, descuento = 0, costo = 0, ganancia = 0, comision = 0;
  for (const l of lineas) {
    const r = comisionDeLinea(l, reglas, tipoVendedorId, porcentajeBaseDelTipo, base);
    facturado += r.facturado;
    descuento += r.descuento;
    costo += r.costo;
    ganancia += r.ganancia;
    comision += r.comision;
  }
  const sobre = base === "facturacion" ? facturado : ganancia;
  return {
    facturado, descuento, costo, ganancia, comision,
    porcentaje_efectivo: sobre > 0 ? (comision / sobre) * 100 : 0,
  };
}

/**
 * ¿El cliente sigue en la cartera de su vendedor? (punto 4.1)
 *
 * Se calcula, no se guarda: ver el comentario del script 24. Sin fecha de
 * última operación no está en cartera — el vendedor figura asignado pero nunca
 * le vendió.
 */
export function enCartera(
  carteraDesde: string | Date | null | undefined,
  diasCartera: number,
  ahora: Date = new Date()
): boolean {
  if (!carteraDesde) return false;
  const d = carteraDesde instanceof Date ? carteraDesde : new Date(carteraDesde);
  if (Number.isNaN(d.getTime())) return false;
  const dias = (ahora.getTime() - d.getTime()) / 86_400_000;
  return dias < diasCartera;
}

/** Días que le quedan al cliente en la cartera. 0 = ya se liberó. */
export function diasRestantesCartera(
  carteraDesde: string | Date | null | undefined,
  diasCartera: number,
  ahora: Date = new Date()
): number {
  if (!carteraDesde) return 0;
  const d = carteraDesde instanceof Date ? carteraDesde : new Date(carteraDesde);
  if (Number.isNaN(d.getTime())) return 0;
  const pasados = (ahora.getTime() - d.getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(diasCartera - pasados));
}
