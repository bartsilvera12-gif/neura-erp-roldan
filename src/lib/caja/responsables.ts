import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Quién puede operar una caja (script 105, pedido del cliente).
 *
 * La caja es de quien la abre y de los administradores. Los demás la ven, pero
 * no le cargan movimientos, no cobran ventas en ella ni la cierran. Si la abre
 * un administrador, elige quién más puede operarla (`responsables`).
 *
 * `responsables` null = caja de antes del script: la opera cualquiera, como
 * hasta hoy. Sin el script (la columna no existe) tampoco se restringe nada.
 */

export type DuenosCaja = { abierta_por: string | null; responsables: string[] | null };

/** Lee abierta_por + responsables de varias cajas. Sin el script, todas sin restricción. */
export async function duenosDeCajas(
  sb: AppSupabaseClient,
  empresaId: string,
  cajaIds: string[]
): Promise<Map<string, DuenosCaja>> {
  const out = new Map<string, DuenosCaja>();
  if (cajaIds.length === 0) return out;
  const r = await sb
    .from("cajas")
    .select("id, abierta_por, responsables")
    .eq("empresa_id", empresaId)
    .in("id", cajaIds);
  if (r.error) return out; // sin script 105: no se restringe
  for (const c of (r.data ?? []) as Array<{ id: string; abierta_por: string | null; responsables: string[] | null }>) {
    out.set(String(c.id), {
      abierta_por: c.abierta_por ?? null,
      responsables: Array.isArray(c.responsables) ? c.responsables.map(String) : null,
    });
  }
  return out;
}

/** ¿Este usuario puede operar la caja? El administrador siempre. */
export function puedeOperarCaja(d: DuenosCaja | undefined, usuarioId: string | null, esAdmin: boolean): boolean {
  if (esAdmin) return true;
  if (!d || d.responsables == null) return true; // caja de antes del script
  if (!usuarioId) return false;
  return d.abierta_por === usuarioId || d.responsables.includes(usuarioId);
}

export const MSG_CAJA_AJENA =
  "Esta caja es de otra persona: podés verla, pero no cargarle movimientos, cobrar ventas en ella ni cerrarla. " +
  "Abrí tu propia caja o pedile a un administrador que te agregue.";

/** Devuelve el mensaje de bloqueo, o null si puede operar la caja. */
export async function bloqueoCaja(
  sb: AppSupabaseClient,
  empresaId: string,
  cajaId: string,
  usuarioId: string | null,
  esAdmin: boolean
): Promise<string | null> {
  if (esAdmin) return null;
  const m = await duenosDeCajas(sb, empresaId, [cajaId]);
  return puedeOperarCaja(m.get(cajaId), usuarioId, esAdmin) ? null : MSG_CAJA_AJENA;
}

export const MSG_SOLO_CAJERA_COBRA =
  "Cobrar lo hace la cajera que abrió la caja (o quien ella tenga agregado) y los administradores.";

/**
 * ¿Puede cobrar? (pedido del cliente: «los usuarios de ventas no deben poder
 * cobrar, solo la cajera que abrió la caja y los administradores».)
 *
 * El administrador siempre. Los demás, solo si hay una caja ABIERTA en su
 * sucursal que abrieron ellos o en la que los agregaron como responsables.
 * Acá no vale la «caja de antes del script, sin restricción»: tiene que ser
 * su caja.
 */
export async function puedeCobrar(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string | null,
  usuarioId: string | null,
  esAdmin: boolean
): Promise<boolean> {
  if (esAdmin) return true;
  if (!usuarioId) return false;
  let q = sb.from("cajas").select("id, abierta_por").eq("empresa_id", empresaId).eq("estado", "abierta");
  if (sucursalId) q = q.eq("sucursal_id", sucursalId);
  const r = await q;
  if (r.error) return false;
  const cajas = (r.data ?? []) as Array<{ id: string; abierta_por: string | null }>;
  if (cajas.some((c) => c.abierta_por === usuarioId)) return true;
  const duenos = await duenosDeCajas(sb, empresaId, cajas.map((c) => String(c.id)));
  return [...duenos.values()].some((d) => (d.responsables ?? []).includes(usuarioId));
}
