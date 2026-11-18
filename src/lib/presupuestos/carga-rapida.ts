/**
 * Lo que comparten «Nuevo presupuesto» y «Editar presupuesto» para cargar
 * rápido, con el teclado.
 */
import type { KeyboardEvent } from "react";

/**
 * Tope de líneas de un presupuesto (pedido del cliente).
 *
 * Diez entran en una hoja impresa; más que eso se parte en dos presupuestos.
 * El servidor lo vuelve a validar: la pantalla se puede saltear.
 */
export const MAX_ITEMS_PRESUPUESTO = 10;

export function mensajeTopeItems(): string {
  return `Un presupuesto lleva hasta ${MAX_ITEMS_PRESUPUESTO} ítems. Para más, armá otro presupuesto.`;
}

/**
 * De dónde salió el precio que se le propone al cliente, en palabras.
 *
 * Recibe lo que contesta /api/productos/[id]/precio-para-cliente. Sin
 * cliente o sin respuesta, es el precio de lista.
 */
export function etiquetaTipoPrecio(d: {
  fuente_detalle?: string | null;
  categoria_nombre?: string | null;
  ajuste_pct?: number | null;
} | null | undefined): string {
  if (!d) return "Lista";
  if (d.fuente_detalle === "excepcion_producto") return "Precio especial del cliente";
  if (d.fuente_detalle === "ajuste_rubro") {
    const pct = Number(d.ajuste_pct) || 0;
    const signo = pct > 0 ? "+" : "";
    const nombre = (d.categoria_nombre ?? "").trim() || "Rubro";
    return pct ? `${nombre} (${signo}${pct.toLocaleString("es-PY")}%)` : nombre;
  }
  return "Lista";
}

/**
 * Enter pasa al campo siguiente de la tabla de ítems, como Tab.
 *
 * Se pone en el contenedor de la tabla (onKeyDown). En el último campo llama
 * a `alFinal`, que vuelve al buscador de productos para la línea que sigue.
 * Las áreas de texto se dejan en paz: ahí Enter es un salto de línea.
 */
export function enterPasaAlSiguiente(e: KeyboardEvent<HTMLElement>, alFinal?: () => void): void {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
  const campos = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>("input:not([disabled]):not([type=hidden]), select:not([disabled])")
  ).filter((el) => el.offsetParent !== null && !(el as HTMLInputElement).readOnly);
  const i = campos.indexOf(t);
  if (i < 0) return;
  e.preventDefault();
  const sig = campos[i + 1];
  if (sig) {
    sig.focus();
    if (sig instanceof HTMLInputElement) sig.select();
  } else {
    alFinal?.();
  }
}
