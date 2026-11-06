/**
 * El aviso a la vendedora: qué se le cambió al presupuesto en la caja.
 *
 * ── LO QUE PIDIÓ EL CLIENTE ────────────────────────────────────────────────
 *   "sistema manda notificación a la vendedora si al cobrar se modifica el
 *    presupuesto, no cambiaria el nombre de la persona a quien se hizo el
 *    presupuesto, que salga la modificación del presupuesto a la hora de
 *    cobrar en alguna parte de presupuesto."
 *
 * ── LAS DOS PUNTAS SE LEEN ACÁ ─────────────────────────────────────────────
 *   Las líneas del presupuesto y las de la venta se leen de la base, en el
 *   servidor. La pantalla de caja no manda la comparación: si la mandara,
 *   quien cobra estaría contando lo que él mismo cambió.
 *
 * ── EL PRESUPUESTO NO CAMBIA DE DUEÑA ──────────────────────────────────────
 *   `vendedor_usuario_id` del aviso sale del presupuesto, no de quien cobró.
 *   Cobrar no transfiere el presupuesto: el aviso le llega a la que lo armó,
 *   aunque después la cambien de puesto.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { compararAlCobrar, type LineaComparable } from "@/lib/presupuestos/cambios-al-cobrar";

/**
 * Compara lo presupuestado con lo cobrado y, si algo cambió, deja el aviso.
 *
 * No tira nunca: la venta ya está cobrada y el presupuesto ya está marcado.
 * Si el aviso no se puede escribir —falta el script 79, se cayó la consulta—
 * se anota en el log y la caja sigue. Perder un aviso es malo; frenar un cobro
 * que ya pasó por la plata es peor.
 *
 * @returns cuántos cambios se guardaron, o null si no se guardó nada.
 */
export async function avisarCambiosAlCobrar(
  supabase: AppSupabaseClient,
  empresaId: string,
  presupuestoId: string,
  ventaId: string
): Promise<number | null> {
  try {
    const [pq, vq, iq, viq] = await Promise.all([
      supabase
        .from("presupuestos")
        .select("numero_control, vendedor_usuario_id, vendedor_nombre, usuario_id, usuario_nombre")
        .eq("empresa_id", empresaId)
        .eq("id", presupuestoId)
        .maybeSingle(),
      supabase
        .from("ventas")
        .select("numero_control, usuario_id, usuario_nombre")
        .eq("empresa_id", empresaId)
        .eq("id", ventaId)
        .maybeSingle(),
      supabase
        .from("presupuesto_items")
        .select("producto_id, producto_nombre, cantidad, precio_unitario")
        .eq("empresa_id", empresaId)
        .eq("presupuesto_id", presupuestoId)
        .limit(1000),
      supabase
        .from("ventas_items")
        .select("producto_id, producto_nombre, cantidad, precio_venta")
        .eq("empresa_id", empresaId)
        .eq("venta_id", ventaId)
        .limit(1000),
    ]);

    if (iq.error) throw new Error(iq.error.message);
    if (viq.error) throw new Error(viq.error.message);

    const presu = (pq.data ?? {}) as Record<string, unknown>;
    const venta = (vq.data ?? {}) as Record<string, unknown>;

    const delPresupuesto: LineaComparable[] = ((iq.data ?? []) as Record<string, unknown>[]).map((r) => ({
      producto_id: r.producto_id == null ? null : String(r.producto_id),
      producto_nombre: String(r.producto_nombre ?? ""),
      cantidad: r.cantidad as number,
      precio_unitario: r.precio_unitario as number,
    }));
    const loCobrado: LineaComparable[] = ((viq.data ?? []) as Record<string, unknown>[]).map((r) => ({
      producto_id: r.producto_id == null ? null : String(r.producto_id),
      producto_nombre: String(r.producto_nombre ?? ""),
      cantidad: r.cantidad as number,
      // En la venta el precio de la línea se llama `precio_venta`.
      precio_unitario: r.precio_venta as number,
    }));

    const r = compararAlCobrar(delPresupuesto, loCobrado);
    // Avisar de lo que no cambió entrena a ignorar los avisos.
    if (!r.hay) return null;

    // A quién avisarle: la que armó el presupuesto. `vendedor_*` es el campo
    // del vendedor asignado; cuando no está, el usuario que lo cargó.
    const vendedorId = presu.vendedor_usuario_id ?? presu.usuario_id ?? null;
    const vendedorNombre = presu.vendedor_nombre ?? presu.usuario_nombre ?? null;

    const ins = await supabase.from("presupuesto_cambios").insert({
      empresa_id: empresaId,
      presupuesto_id: presupuestoId,
      presupuesto_numero: presu.numero_control == null ? null : String(presu.numero_control),
      venta_id: ventaId,
      venta_numero: venta.numero_control == null ? null : String(venta.numero_control),
      vendedor_usuario_id: vendedorId == null ? null : String(vendedorId),
      vendedor_nombre: vendedorNombre == null ? null : String(vendedorNombre),
      cobrado_por_id: venta.usuario_id == null ? null : String(venta.usuario_id),
      cobrado_por_nombre: venta.usuario_nombre == null ? null : String(venta.usuario_nombre),
      cambios: r.cambios,
      total_presupuesto: r.total_presupuesto,
      total_cobrado: r.total_cobrado,
    });
    if (ins.error) throw new Error(ins.error.message);

    return r.cambios.length;
  } catch (err) {
    // Falta el script 79, o la consulta se cayó. La caja sigue.
    console.warn(
      "[aviso-cambios] no se pudo dejar el aviso del presupuesto modificado",
      { presupuestoId, ventaId, motivo: err instanceof Error ? err.message : String(err) }
    );
    return null;
  }
}
