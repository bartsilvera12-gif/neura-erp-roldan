import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { diasCorridos, diasHabilesPy } from "@/lib/rrhh/vacaciones-py";

/**
 * Cuántos días ocupa una ausencia, como se cuenta en Paraguay.
 *
 *   · Vacaciones: días hábiles, lunes a sábado, sin domingos ni feriados
 *     (los fijos más los cargados en RRHH → Feriados).
 *   · Reposo, permisos y el resto: días corridos.
 *
 * Reemplaza el cálculo "a la española" (naturales o lunes a viernes), que
 * contaba el sábado como no laborable y no conocía los feriados.
 */
export async function contarDiasAusencia(
  sb: AppSupabaseClient,
  empresaId: string,
  desde: string,
  hasta: string,
  tipoAusencia: string
): Promise<{ dias: number; computo: "habiles" | "corridos"; corridos: number }> {
  const corridos = diasCorridos(desde, hasta);
  if (tipoAusencia !== "vacaciones") return { dias: corridos, computo: "corridos", corridos };
  const fq = await sb.from("feriados").select("fecha").eq("empresa_id", empresaId).gte("fecha", desde).lte("fecha", hasta);
  // Sin tabla de feriados se cuenta igual con los fijos.
  const cargados = fq.error ? [] : ((fq.data ?? []) as Array<{ fecha: string }>).map((f) => String(f.fecha).slice(0, 10));
  return { dias: diasHabilesPy(desde, hasta, cargados), computo: "habiles", corridos };
}
