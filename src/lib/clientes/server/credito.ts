import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * El crédito que tiene disponible un cliente.
 *
 * ── QUÉ CUENTA COMO DEUDA ─────────────────────────────────────────────────
 *   Las ventas a crédito que todavía no están cobradas del todo. Una venta a
 *   crédito ya cobrada no ocupa límite: el cliente pagó y el cupo volvió.
 *   Las anuladas tampoco.
 *
 * ── POR QUÉ SE MIDE ACÁ Y NO EN LA PANTALLA ───────────────────────────────
 *   Por lo mismo que el tope de descuento: una cuenta que solo vive en el
 *   navegador no es un control, es una sugerencia. Además el saldo cambia
 *   mientras el vendedor arma la venta —otro cajero puede estar cobrándole al
 *   mismo cliente—, así que el número bueno es el del momento de registrar.
 */

export interface CreditoCliente {
  /** Cuánto puede deber. null = sin límite. */
  limite: number | null;
  /** Plazo acordado en días. null = sin plazo acordado. */
  dias: number | null;
  /** Lo que ya debe de ventas a crédito sin cobrar. */
  deuda: number;
  /** Cuánto le queda. null cuando no hay límite. */
  disponible: number | null;
}

const n = (v: unknown): number => Number(v) || 0;

export async function creditoDe(
  sb: AppSupabaseClient,
  empresaId: string,
  clienteId: string
): Promise<CreditoCliente | null> {
  const c = await sb
    .from("clientes")
    .select("limite_credito, dias_credito")
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .maybeSingle();
  // Sin el script 36 la columna de días no existe: se reintenta sin ella en
  // vez de dejar de vender a crédito por una migración que falta.
  let limite: number | null = null;
  let dias: number | null = null;
  if (c.error) {
    if (!/dias_credito/.test(c.error.message ?? "")) throw new Error(c.error.message);
    const c2 = await sb
      .from("clientes")
      .select("limite_credito")
      .eq("empresa_id", empresaId)
      .eq("id", clienteId)
      .maybeSingle();
    if (c2.error) throw new Error(c2.error.message);
    if (!c2.data) return null;
    const f = c2.data as { limite_credito?: number | string | null };
    limite = f.limite_credito == null ? null : n(f.limite_credito);
  } else {
    if (!c.data) return null;
    const f = c.data as { limite_credito?: number | string | null; dias_credito?: number | string | null };
    limite = f.limite_credito == null ? null : n(f.limite_credito);
    dias = f.dias_credito == null ? null : n(f.dias_credito);
  }

  // Sin límite no hace falta sumar nada: la consulta de la deuda es lo caro.
  if (limite == null) return { limite: null, dias, deuda: 0, disponible: null };

  // La deuda sale de las cuentas por cobrar y no de las ventas: ahí está el
  // saldo real, ya descontados los cobros parciales. Una venta a crédito
  // cobrada a medias ocupa solo lo que falta, que es lo justo.
  const v = await sb
    .from("cuentas_por_cobrar")
    .select("saldo, estado")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .limit(2000);
  if (v.error) throw new Error(v.error.message);

  let deuda = 0;
  for (const r of (v.data ?? []) as Array<Record<string, unknown>>) {
    const estado = String(r.estado ?? "");
    if (estado === "anulada" || estado === "pagado") continue;
    const saldo = n(r.saldo);
    if (saldo > 0) deuda += saldo;
  }

  return { limite, dias, deuda, disponible: Math.max(0, limite - deuda) };
}

/**
 * Revisa una venta a crédito contra el crédito del cliente. Devuelve el
 * mensaje de error, o null si está todo bien.
 */
export function validarCredito(
  credito: CreditoCliente | null,
  total: number,
  plazoDias: number | null
): string | null {
  if (!credito) return null;

  if (credito.limite != null) {
    if (credito.limite === 0) {
      return "Este cliente no tiene crédito habilitado. Cobrale al contado o subile el límite en su ficha.";
    }
    if (credito.deuda + total > credito.limite) {
      const gs = (x: number) => `Gs. ${Math.round(x).toLocaleString("es-PY")}`;
      return (
        `El cliente ya debe ${gs(credito.deuda)} y su límite es ${gs(credito.limite)}: ` +
        `le quedan ${gs(credito.disponible ?? 0)} y esta venta es de ${gs(total)}.`
      );
    }
  }

  if (credito.dias != null && plazoDias != null && plazoDias > credito.dias) {
    return `El plazo acordado con este cliente es de ${credito.dias} días y esta venta tiene ${plazoDias}.`;
  }

  return null;
}
