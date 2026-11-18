import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { baseIps } from "@/lib/rrhh/ips";
import { aportaIps } from "@/lib/rrhh/contrato";

/**
 * Sobre qué aporta al IPS un empleado: lo mismo que usa el alta del recibo
 * (`/api/rrhh/nomina/recibos` POST), para que editar el recibo no cambie la
 * cuenta.
 *
 *  - `sinIps`: es facturador, no aporta.
 *  - `baseMensual`: el monto MENSUAL declarado (el mínimo o uno propio), o
 *    null si se declara lo que cobra —ahí el aporte sale de lo imponible del
 *    recibo—. Se prorratea por los días con `baseDelPeriodo`.
 *
 * Antes, al editar un recibo el IPS se recalculaba siempre sobre lo que cobra:
 * a quien se le declara el mínimo, guardar cualquier cambio le subía el
 * descuento.
 */
export async function ipsDelEmpleado(
  sb: AppSupabaseClient,
  empresaId: string,
  empleadoId: string | null | undefined
): Promise<{ sinIps: boolean; baseMensual: number | null }> {
  if (!empleadoId) return { sinIps: false, baseMensual: null };
  let e = await sb
    .from("empleados")
    .select("salario_base, salario_ips, ips_sobre_minimo, tipo_contrato")
    .eq("empresa_id", empresaId)
    .eq("id", empleadoId)
    .maybeSingle();
  if (e.error) {
    // Sin las columnas del IPS (script 77) se declara lo que cobra, como antes.
    e = await sb.from("empleados").select("salario_base, tipo_contrato").eq("empresa_id", empresaId).eq("id", empleadoId).maybeSingle();
    if (e.error) return { sinIps: false, baseMensual: null };
  }
  const emp = (e.data ?? {}) as Record<string, unknown>;
  if (!aportaIps(emp.tipo_contrato as string | null)) return { sinIps: true, baseMensual: null };

  const pq = await sb.from("rrhh_parametros").select("salario_minimo").eq("empresa_id", empresaId).maybeSingle();
  const minimo = pq.error ? null : (pq.data as { salario_minimo?: number | null } | null)?.salario_minimo ?? null;
  const ips = baseIps(
    {
      salario_base: Number(emp.salario_base) || 0,
      salario_ips: emp.salario_ips == null ? null : Number(emp.salario_ips),
      ips_sobre_minimo: emp.ips_sobre_minimo === true,
    },
    minimo
  );
  // "real" y "sin mínimo cargado" se calculan sobre lo imponible del recibo.
  const baseMensual = ips.origen === "real" || ips.origen === "sin_minimo_cargado" ? null : ips.base;
  return { sinIps: false, baseMensual };
}
