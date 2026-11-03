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
  lineas: LineaParaStock[],
  /**
   * El presupuesto que se está por cobrar, para que su propia reserva no se
   * le descuente a sí mismo. Al crear uno nuevo no se pasa: todavía no
   * reserva nada.
   */
  excluirPresupuestoId?: string | null
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

  const existencias = await existenciasConReserva(
    sb, empresaId, sucursalId, [...pedido.keys()], excluirPresupuestoId
  );
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

/**
 * Lo que le falta de stock a un presupuesto ya guardado, para poder cobrarlo.
 *
 * ── POR QUÉ ESTO NO ES LO MISMO QUE AL CREARLO ────────────────────────────
 *   Cotizar sin stock es válido: se ofrece, el cliente acepta y recién
 *   entonces se compra. Lo que no se puede es ENTREGAR lo que no está, y
 *   facturar es entregar. Por eso la misma cuenta se hace dos veces, en dos
 *   momentos distintos, y en el segundo no mira quién la pide: ni el
 *   administrador puede facturar mercadería que no existe.
 *
 *   Se excluye la reserva del propio presupuesto: si está aprobado, ya tiene
 *   reservada esa mercadería para sí mismo, y contarla sería descontarle lo
 *   que justamente se le va a entregar.
 */
export async function faltantesParaFacturar(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null,
  presupuestoId: string
): Promise<Faltante[]> {
  const itemsQ = await sb
    .from("presupuesto_items")
    .select("producto_id, producto_nombre, cantidad")
    .eq("empresa_id", empresaId)
    .eq("presupuesto_id", presupuestoId)
    .limit(1000);
  if (itemsQ.error) throw new Error(itemsQ.error.message);

  const lineas: LineaParaStock[] = ((itemsQ.data ?? []) as Array<Record<string, unknown>>).map((it) => ({
    producto_id: it.producto_id ? String(it.producto_id) : null,
    producto_nombre: String(it.producto_nombre ?? ""),
    cantidad: Number(it.cantidad) || 0,
  }));

  return faltantesDeStock(sb, empresaId, sucursalId, lineas, presupuestoId);
}

/** El mensaje de por qué este presupuesto todavía no se puede cobrar. */
export function mensajeNoFacturable(faltantes: Faltante[]): string {
  const detalle = faltantes
    .slice(0, 5)
    .map((f) => `${f.producto_nombre || "un producto"} (faltan ${f.falta})`)
    .join("; ");
  const resto = faltantes.length > 5 ? ` y ${faltantes.length - 5} más` : "";
  return (
    `No se puede cobrar: falta stock de ${faltantes.length === 1 ? "un producto" : `${faltantes.length} productos`}. ` +
    `${detalle}${resto}. Hay que comprar la mercadería antes de facturar, o editar el presupuesto.`
  );
}
