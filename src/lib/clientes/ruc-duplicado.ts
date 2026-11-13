import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * ¿Ya hay otro cliente con ese RUC o cédula? (BUG-01)
 *
 * Los RUC no están guardados con un formato único —"1234567-8",
 * "1.234.567-8", "1234567"—, así que se compara por los DÍGITOS. Para no traer
 * los 21 mil clientes, se buscan candidatos con un patrón de dígitos
 * intercalados (`%1%2%3…%`) y se confirman acá.
 *
 * El dígito verificador cuenta: "1234567-8" y "1234567" se tratan como el
 * mismo documento (el segundo es la cédula sin DV), igual que se buscan en
 * Clientes.
 */
export function digitosRuc(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Sin el dígito verificador, si lo tiene ("1234567-8" → "1234567"). */
function base(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /^(.*\d)\s*-\s*\d$/.exec(s);
  return digitosRuc(m ? m[1] : s);
}

export async function clienteConMismoRuc(
  sb: AppSupabaseClient,
  empresaId: string,
  ruc: unknown,
  excluirId?: string | null
): Promise<{ id: string; nombre: string } | null> {
  const b = base(ruc);
  if (b.length < 5) return null; // muy corto para afirmar que es el mismo
  const patron = `%${b.split("").join("%")}%`;
  let q = sb
    .from("clientes")
    .select("id, ruc, documento, nombre, empresa, deleted_at")
    .eq("empresa_id", empresaId)
    .is("deleted_at", null)
    .or(`ruc.ilike.${patron},documento.ilike.${patron}`)
    .limit(50);
  if (excluirId) q = q.neq("id", excluirId);
  const { data, error } = await q;
  if (error) return null; // si no se puede verificar, no se frena el alta
  for (const c of (data ?? []) as Array<Record<string, unknown>>) {
    if (base(c.ruc) === b || base(c.documento) === b) {
      return { id: String(c.id), nombre: String(c.empresa || c.nombre || "otro cliente") };
    }
  }
  return null;
}
