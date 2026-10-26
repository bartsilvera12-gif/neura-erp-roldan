import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Escribe el delta con signo de un movimiento (punto 1.4).
 *
 * POR QUÉ ESTO EXISTE
 *   `movimientos_inventario.cantidad` guarda SIEMPRE el valor absoluto. Un
 *   ajuste de 95 a 90 quedaba como "5", sin decir que era una baja. El
 *   historial de ajustes necesita el signo, así que se agregaron
 *   `cantidad_delta`, `stock_antes` y `stock_despues` (script 19).
 *
 * POR QUÉ ES UN INSERT Y DESPUÉS UN UPDATE, Y NO TODO JUNTO
 *   Los ajustes se crean desde tres lugares distintos y las columnas vienen de
 *   un script que puede no estar corrido todavía. Si los campos fueran parte
 *   del insert, en una base sin migrar el movimiento no se registraría y el
 *   stock cambiaría sin dejar rastro — el peor resultado posible.
 *
 *   Separado, el movimiento se guarda igual y lo único que falta es el signo.
 *   Esta función nunca lanza: su falla no puede voltear la operación.
 */
export async function guardarDelta(
  supabase: AppSupabaseClient,
  empresaId: string,
  movimientoId: string,
  datos: { delta: number; stockAntes: number; stockDespues: number }
): Promise<void> {
  try {
    const r = await supabase
      .from("movimientos_inventario")
      .update({
        cantidad_delta: datos.delta,
        stock_antes: datos.stockAntes,
        stock_despues: datos.stockDespues,
      })
      .eq("empresa_id", empresaId)
      .eq("id", movimientoId);
    if (r.error && !/cantidad_delta|stock_antes|stock_despues/.test(r.error.message ?? "")) {
      console.error("[movimiento-delta]", r.error.message);
    }
  } catch (err) {
    console.error("[movimiento-delta]", err instanceof Error ? err.message : err);
  }
}
