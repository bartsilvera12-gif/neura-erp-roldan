import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { existenciasConReserva } from "@/lib/presupuestos/server/reservas";

/**
 * Cotizar más de lo que hay: solo el administrador.
 *
 * ── POR QUÉ SE PUEDE COTIZAR SIN STOCK, Y POR QUÉ AHORA NO CUALQUIERA ─────
 *   El punto 9.1 era justamente poder cotizar lo que no hay: en una ferretería
 *   lo normal es ofrecer, que el cliente acepte y recién entonces comprar. Eso
 *   no cambia.
 *
 *   Lo que cambia es QUIÉN. Prometer mercadería que no está es asumir un
 *   compromiso de compra y una fecha de entrega: si el que cotiza no es el que
 *   después tiene que conseguir el material, el presupuesto sale con un plazo
 *   que nadie puede cumplir y el reclamo llega igual. El administrador puede
 *   hacerlo porque es el que decide comprar.
 *
 *   Se mide contra el DISPONIBLE y no contra el físico: lo que ya está
 *   comprometido en otro presupuesto aprobado no se puede prometer dos veces.
 */

export interface LineaParaStock {
  producto_id: string | null;
  producto_nombre: string;
  cantidad: number;
}

export interface Faltante {
  producto_id: string;
  producto_nombre: string;
  pedido: number;
  disponible: number;
  falta: number;
}

/**
 * Las líneas que piden más de lo disponible.
 *
 * Las líneas escritas a mano (sin producto del catálogo) no se miden: no hay
 * contra qué, y son justamente las que se usan para cotizar algo que todavía
 * no existe en el sistema.
 */
export async function faltantesDeStock(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null,
  lineas: LineaParaStock[]
): Promise<Faltante[]> {
  // Varias líneas del mismo producto suman: tres líneas de 10 de la misma
  // chapa son 30, y medidas por separado cada una "entra" cuando hay 15.
  const pedido = new Map<string, { nombre: string; cantidad: number }>();
  for (const l of lineas) {
    const id = l.producto_id ? String(l.producto_id) : "";
    if (!id) continue;
    const prev = pedido.get(id);
    const cant = Number(l.cantidad) || 0;
    pedido.set(id, {
      nombre: prev?.nombre || l.producto_nombre || "",
      cantidad: (prev?.cantidad ?? 0) + cant,
    });
  }
  if (pedido.size === 0) return [];

  const existencias = await existenciasConReserva(sb, empresaId, sucursalId, [...pedido.keys()]);
  const porId = new Map(existencias.map((e) => [String(e.producto_id), e]));

  const out: Faltante[] = [];
  for (const [id, p] of pedido) {
    const ex = porId.get(id);
    // Sin dato de existencia no se bloquea: un producto que no se pudo leer no
    // es un producto sin stock, y frenar la cotización por eso sería frenarla
    // por un problema nuestro.
    if (!ex) continue;
    const disponible = Number(ex.disponible) || 0;
    const falta = p.cantidad - disponible;
    if (falta > 0) {
      out.push({
        producto_id: id,
        producto_nombre: p.nombre || ex.nombre || "",
        pedido: p.cantidad,
        disponible,
        falta,
      });
    }
  }
  return out;
}

/** El mensaje que ve el que no puede cotizar sin stock. */
export function mensajeFaltantes(faltantes: Faltante[]): string {
  const detalle = faltantes
    .slice(0, 5)
    .map((f) => `${f.producto_nombre || "un producto"} (pedís ${f.pedido}, hay ${f.disponible})`)
    .join("; ");
  const resto = faltantes.length > 5 ? ` y ${faltantes.length - 5} más` : "";
  return (
    `No alcanza el stock para ${faltantes.length === 1 ? "un producto" : `${faltantes.length} productos`}: ` +
    `${detalle}${resto}. Cotizar más de lo que hay lo hace un administrador, ` +
    "porque es asumir una compra y una fecha de entrega."
  );
}
