import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Una venta de una caja CERRADA ya no se toca (pedido del cliente): no se
 * edita, no se anula y no se le cambia el medio de cobro, ni siquiera un
 * administrador. Solo se vuelve a imprimir.
 *
 * Mientras la caja está abierta o en cierre (conteo) sí se puede corregir.
 * Para arreglar una venta de una caja ya cerrada, primero se reabre la caja:
 * así el arqueo se vuelve a contar con la corrección adentro.
 *
 * Las ventas sin caja (las migradas del sistema anterior) quedan con las
 * reglas de siempre.
 */
export const MENSAJE_CAJA_CERRADA =
  "La caja de esta venta ya está cerrada: la venta solo se puede volver a imprimir. " +
  "Para corregirla, primero hay que reabrir la caja.";

export async function ventaDeCajaCerrada(
  sb: AppSupabaseClient,
  empresaId: string,
  ventaId: string
): Promise<boolean> {
  const v = await sb.from("ventas").select("caja_id").eq("empresa_id", empresaId).eq("id", ventaId).maybeSingle();
  const cajaId = (v.data as { caja_id?: string | null } | null)?.caja_id ?? null;
  if (v.error || !cajaId) return false;
  return cajaCerrada(sb, empresaId, cajaId);
}

export async function cajaCerrada(sb: AppSupabaseClient, empresaId: string, cajaId: string): Promise<boolean> {
  const c = await sb.from("cajas").select("estado").eq("empresa_id", empresaId).eq("id", cajaId).maybeSingle();
  if (c.error) return false;
  return String((c.data as { estado?: string } | null)?.estado ?? "") === "cerrada";
}
