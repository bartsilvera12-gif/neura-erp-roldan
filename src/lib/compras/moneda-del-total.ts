import type { MonedaFlujo } from "@/lib/flujo-caja/types";

/**
 * En qué moneda está el `total` de una compra.
 *
 * ── LO MEDIDO ──────────────────────────────────────────────────────────────
 *   Siempre en guaraníes. `compras.moneda` dice otra cosa en la mayoría de las
 *   filas, y no hay que creerle:
 *
 *     · 684 de cada 1.000 compras están marcadas USD.
 *     · De 1.000 filas marcadas USD, 1.000 tienen el total en escala de
 *       guaraníes: el más chico es 81.922 y la mediana 1.576.347. Ninguna
 *       baja de 10.000, que es lo que tendría que pasar si fueran dólares.
 *     · La factura 33644 de PERFILADOS (HCO-005153) suma 13.566.350 entre sus
 *       líneas, y es exactamente el total que la pantalla muestra como
 *       Gs. 13.566.350.
 *
 *   `compras.moneda` guarda la moneda en que se NEGOCIÓ la compra —el dato del
 *   proveedor—, no la del número que quedó en `total`. La migración lo dejó
 *   así y el ERP viejo lo usaba igual.
 *
 * ── POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `"PYG"` SUELTO ─────────────────────
 *   Porque hay más de un lugar que compara el importe de una factura con el de
 *   un pago, y cada uno que lea `compras.moneda` por su cuenta vuelve a
 *   inventar el error: un cheque de 13.566.350 Gs. contra una factura leída
 *   como "US$ 13.566.350" da 6.400 veces de diferencia y la pantalla frena un
 *   pago que estaba bien.
 *
 *   El día que se corrijan los datos, se cambia acá y en ningún lado más.
 */
export function monedaDelTotalDeCompra(_monedaDeLaFila?: string | null): MonedaFlujo {
  return "PYG";
}
