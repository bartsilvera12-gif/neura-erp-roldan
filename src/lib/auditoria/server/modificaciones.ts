import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Rastro de lo que toca un administrador.
 *
 * Ya hay historiales por módulo (`ventas_ediciones`, `precios_historial`), que
 * guardan el detalle campo por campo. Esto es lo otro: el único lugar donde se
 * puede preguntar "qué tocó el administrador esta semana" sin recorrer seis
 * pantallas.
 *
 * NUNCA LANZA
 *   Registrar el rastro no puede tirar abajo la operación que lo generó. Si
 *   una venta se anuló, se anuló: que además falle el registro es un problema
 *   menor y se anota en el log del servidor. Al revés —perder la anulación
 *   porque no se pudo escribir la auditoría— sería mucho peor.
 */
export interface ModificacionAdministrativa {
  /** Qué se tocó: "venta", "caja", "presupuesto", "producto", "comisiones"… */
  entidad: string;
  entidad_id?: string | null;
  /** El número que el usuario reconoce: VTA-000018, PRE-0007. */
  referencia?: string | null;
  /** Qué se hizo: "editar", "anular", "reabrir", "configurar"… */
  accion: string;
  /** En palabras, para que se lea sin descifrar nada. */
  detalle?: string | null;
  motivo?: string | null;
  usuario_id?: string | null;
  usuario_nombre: string;
  es_admin: boolean;
  sucursal_id?: string | null;
}

export async function registrarModificacionAdministrativa(
  sb: AppSupabaseClient,
  empresaId: string,
  m: ModificacionAdministrativa
): Promise<void> {
  // Sin nombre no hay rastro que valga: la tabla existe para decir quién fue,
  // y la base lo rechaza igual con un CHECK.
  const nombre = (m.usuario_nombre ?? "").trim() || "(sin nombre)";
  try {
    const r = await sb.from("modificaciones_administrativas").insert({
      empresa_id: empresaId,
      sucursal_id: m.sucursal_id ?? null,
      entidad: m.entidad,
      entidad_id: m.entidad_id ?? null,
      referencia: m.referencia ?? null,
      accion: m.accion,
      detalle: m.detalle ? String(m.detalle).slice(0, 2000) : null,
      motivo: m.motivo ? String(m.motivo).slice(0, 1000) : null,
      usuario_id: m.usuario_id ?? null,
      usuario_nombre: nombre,
      es_admin: m.es_admin === true,
    });
    if (r.error) {
      // Sin el script 48 la tabla no existe: se anota y se sigue.
      console.warn("[modificaciones-administrativas]", r.error.message);
    }
  } catch (e) {
    console.warn("[modificaciones-administrativas]", e instanceof Error ? e.message : e);
  }
}
