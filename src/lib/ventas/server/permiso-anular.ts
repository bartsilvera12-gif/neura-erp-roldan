import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { getCajaAbierta } from "@/lib/caja/server";

/**
 * Quién puede anular una venta (requisito 11.4).
 *
 * ── LA REGLA, Y POR QUÉ ESTA Y NO OTRA ────────────────────────────────────
 *   El cajero puede anular una venta de SU TURNO ABIERTO. Cualquier venta de
 *   un turno ya cerrado exige administrador.
 *
 *   Las dos puntas tienen su motivo:
 *
 *   · Dejarlo todo en manos del admin frenaría el mostrador: una venta mal
 *     cargada se detecta en el momento, con el cliente delante, y pedir que
 *     venga alguien con permiso para cada error de tipeo convierte un
 *     problema de diez segundos en una cola.
 *
 *   · Dejarlo abierto para siempre es otra cosa. Una venta de un turno
 *     cerrado ya se contó en un arqueo que alguien firmó; anularla mueve
 *     plata de un día que ya se cuadró, y eso no se corrige solo. Ahí el
 *     control vale más que la agilidad.
 *
 *   Es el mismo criterio que ya rige para reabrir una caja (punto 5.1): lo
 *   del turno en curso se resuelve en el turno; lo de ayer lo mira un
 *   administrador.
 *
 * Una venta sin `caja_id` —cargada fuera de un turno— se trata como vieja:
 * no hay turno al que pertenezca, así que no hay nadie que pueda decir que
 * es "la de ahora".
 */

export type PermisoAnular =
  | { permitido: true; motivo: null }
  | { permitido: false; motivo: string };

export async function puedeAnularVenta(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    sucursalId: string | null;
    esAdmin: boolean;
    /** La caja a la que pertenece la venta. */
    cajaIdVenta: string | null;
  }
): Promise<PermisoAnular> {
  if (params.esAdmin) return { permitido: true, motivo: null };

  if (!params.cajaIdVenta) {
    return {
      permitido: false,
      motivo:
        "Esa venta no pertenece a ningún turno de caja abierto. " +
        "Para anularla hace falta un administrador.",
    };
  }

  // Si falla la consulta se niega el permiso en vez de concederlo: ante la
  // duda, que no se anule.
  const abierta = await getCajaAbierta(sb, params.empresaId, params.sucursalId).catch(() => null);
  if (!abierta) {
    return {
      permitido: false,
      motivo:
        "No hay un turno de caja abierto en esta sucursal. " +
        "Para anularla hace falta un administrador.",
    };
  }
  if (String(abierta.id) !== String(params.cajaIdVenta)) {
    return {
      permitido: false,
      motivo:
        "Esa venta es de un turno que ya se cerró y se arqueó. " +
        "Para anularla hace falta un administrador.",
    };
  }

  return { permitido: true, motivo: null };
}
